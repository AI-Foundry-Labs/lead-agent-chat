import { createGateway } from '@ai-sdk/gateway';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';

// Provider-agnostic model resolution. Preferred path is the Vercel AI Gateway
// (one AI_GATEWAY_API_KEY for every provider, LLM_MODEL = "provider/model").
// As a dev fallback, when no gateway key is set but a Google key is present, we
// talk to Google directly so the agent works without a gateway account.
export const MODEL_ID = process.env.LLM_MODEL ?? 'anthropic/claude-sonnet-4.6';
export const FAST_MODEL_ID =
  process.env.LLM_FAST_MODEL ?? 'google/gemini-2.5-flash-lite';

const googleKey =
  process.env.GOOGLE_GENERATIVE_AI_API_KEY ??
  process.env.GOOGLE_API_KEY ??
  process.env.LLM_API_KEY;

function stripProvider(id: string): string {
  return id.includes('/') ? id.slice(id.indexOf('/') + 1) : id;
}

function resolveModel(id: string): LanguageModel {
  if (process.env.AI_GATEWAY_API_KEY) {
    return createGateway({ apiKey: process.env.AI_GATEWAY_API_KEY })(id);
  }
  if (googleKey) {
    return createGoogleGenerativeAI({ apiKey: googleKey })(stripProvider(id));
  }
  // No credentials configured — keep the gateway shape so the error is explicit.
  return createGateway({})(id);
}

export const MODEL = resolveModel(MODEL_ID);
export const FAST_MODEL = resolveModel(FAST_MODEL_ID);
