import { createGateway } from '@ai-sdk/gateway';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';

// Provider-agnostic model resolution.
//
// Model ids are written as "provider/model" (e.g. "openai/gpt-4o",
// "anthropic/claude-sonnet-4.6", "google/gemini-2.5-flash-lite"). The provider
// prefix is REQUIRED — a bare model id throws so misconfiguration fails loudly
// instead of silently hitting the wrong provider.
//
// Resolution order:
//   1. If AI_GATEWAY_API_KEY is set, every id goes through the Vercel AI
//      Gateway (one key for all providers — kept for compatibility).
//   2. Otherwise the "provider/" prefix selects the SDK and its API key.
export const MODEL_ID = process.env.LLM_MODEL ?? 'openai/gpt-4o';
export const FAST_MODEL_ID =
  process.env.LLM_FAST_MODEL ?? 'openai/gpt-4o-mini';

// Per-provider key lookups. Each provider accepts its conventional env var,
// falling back to the generic LLM_API_KEY for single-provider dev setups.
const PROVIDER_KEYS: Record<string, () => string | undefined> = {
  openai: () => process.env.OPENAI_API_KEY ?? process.env.LLM_API_KEY,
  anthropic: () => process.env.ANTHROPIC_API_KEY ?? process.env.LLM_API_KEY,
  google: () =>
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ??
    process.env.GOOGLE_API_KEY ??
    process.env.LLM_API_KEY,
};

function splitProvider(id: string): { provider: string; model: string } {
  const slash = id.indexOf('/');
  if (slash === -1) {
    throw new Error(
      `LLM model id must be "provider/model" (e.g. "openai/gpt-4o"), got "${id}". ` +
        `Set LLM_MODEL / LLM_FAST_MODEL with a provider prefix.`,
    );
  }
  return { provider: id.slice(0, slash), model: id.slice(slash + 1) };
}

function requireKey(provider: string): string {
  const key = PROVIDER_KEYS[provider]?.();
  if (!key) {
    const envVar = provider.toUpperCase() + '_API_KEY';
    throw new Error(
      `No API key for provider "${provider}". Set ${envVar} (or LLM_API_KEY) in your environment.`,
    );
  }
  return key;
}

function resolveModel(id: string): LanguageModel {
  // Gateway path: one key fronts every provider, so pass the full id through.
  if (process.env.AI_GATEWAY_API_KEY) {
    return createGateway({ apiKey: process.env.AI_GATEWAY_API_KEY })(id);
  }

  const { provider, model } = splitProvider(id);
  const apiKey = requireKey(provider);

  switch (provider) {
    case 'openai':
      return createOpenAI({ apiKey })(model);
    case 'anthropic':
      return createAnthropic({ apiKey })(model);
    case 'google':
      return createGoogleGenerativeAI({ apiKey })(model);
    default:
      throw new Error(
        `Unsupported LLM provider "${provider}". Supported: openai, anthropic, google ` +
          `(or set AI_GATEWAY_API_KEY to route any provider through the Vercel AI Gateway).`,
      );
  }
}

export const MODEL = resolveModel(MODEL_ID);
export const FAST_MODEL = resolveModel(FAST_MODEL_ID);
