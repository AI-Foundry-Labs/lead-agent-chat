/**
 * Tiny HTTP proxy: listens on HOST and forwards to https://api.telegram.org
 * Run on HOST (outside Docker): node scripts/telegram-api-proxy.mjs
 * Docker containers use TELEGRAM_API_ROOT=http://172.20.0.1:8765
 */
import http from 'http';
import https from 'https';

const PORT = process.env.TELEGRAM_PROXY_PORT || 8765;

const server = http.createServer((req, res) => {
  const target = `https://api.telegram.org${req.url}`;
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const proxyReq = https.request(target, {
      method: req.method,
      headers: {
        ...req.headers,
        host: 'api.telegram.org',
        'content-length': body.length
      }
    }, proxyRes => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', e => {
      console.error('[proxy] upstream error:', e.message);
      if (!res.headersSent) { res.writeHead(502); res.end(e.message); }
    });
    proxyReq.end(body);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Telegram API proxy listening on :${PORT}`);
  console.log(`Set TELEGRAM_API_ROOT=http://172.20.0.1:${PORT} in Docker .env`);
});
