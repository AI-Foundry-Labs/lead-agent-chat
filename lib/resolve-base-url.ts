/**
 * Resolves the app's public base URL at runtime.
 *
 * Priority:
 *   1. Query local ngrok API (localhost:4040) for the current tunnel URL —
 *      this stays accurate across ngrok restarts without touching .env.
 *   2. Fall back to APP_BASE_URL env var.
 *   3. Fall back to http://localhost:3000.
 *
 * The resolved URL is cached for CACHE_TTL_MS to avoid hammering the ngrok API
 * on every email/magic-link send.
 */

const CACHE_TTL_MS = 60_000; // re-query ngrok every 60 s
const NGROK_API = 'http://127.0.0.1:4040/api/tunnels';

let cachedUrl: string | null = null;
let cacheExpiry = 0;

async function queryNgrokUrl(): Promise<string | null> {
  try {
    const res = await fetch(NGROK_API, { signal: AbortSignal.timeout(1000) });
    if (!res.ok) return null;
    const { tunnels } = (await res.json()) as { tunnels: { name: string; public_url: string; config: { addr: string } }[] };

    // NGROK_TUNNEL_NAME lets each instance claim its own tunnel (e.g. "main", "fr-qc1").
    const tunnelName = process.env.NGROK_TUNNEL_NAME;
    if (tunnelName) {
      const match = tunnels.find((t) => t.name === tunnelName);
      return match?.public_url ?? null;
    }

    // Fallback: pick first HTTPS tunnel.
    const match = tunnels.find((t) => t.public_url.startsWith('https://'));
    return match?.public_url ?? null;
  } catch {
    return null;
  }
}

export async function resolveBaseUrl(): Promise<string> {
  const now = Date.now();
  if (cachedUrl && now < cacheExpiry) return cachedUrl;

  const ngrokUrl = await queryNgrokUrl();
  if (ngrokUrl) {
    cachedUrl = ngrokUrl;
    cacheExpiry = now + CACHE_TTL_MS;
    return ngrokUrl;
  }

  // Fallback: static env var or localhost.
  return process.env.APP_BASE_URL ?? 'http://localhost:3000';
}
