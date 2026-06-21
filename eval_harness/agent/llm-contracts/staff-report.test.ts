/**
 * LLM contract tests for generateStaffReport — real FAST_MODEL call.
 * Skipped automatically when no API key is available in the environment.
 * Verifies behavioral contracts (non-empty, marker-prefixed, report-style),
 * not exact wording.
 *
 * Run: ./eval_harness/run-tests.sh llm
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateStaffReport,
  STAFF_MARKER
} from '../../../lib/agent/staff-report.ts';

function hasLlmKey(): boolean {
  if (process.env.AI_GATEWAY_API_KEY) return true;
  const fastModel = process.env.LLM_FAST_MODEL ?? 'openai/gpt-4o-mini';
  const provider = fastModel.split('/')[0];
  const keyMap: Record<string, string | undefined> = {
    openai: process.env.OPENAI_API_KEY ?? process.env.LLM_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY ?? process.env.LLM_API_KEY,
    google:
      process.env.GOOGLE_GENERATIVE_AI_API_KEY ??
      process.env.GOOGLE_API_KEY ??
      process.env.LLM_API_KEY
  };
  return !!keyMap[provider];
}

const SKIP: string | undefined = hasLlmKey()
  ? undefined
  : 'No LLM API key — set LLM_API_KEY, provider-specific key, or AI_GATEWAY_API_KEY';

describe('generateStaffReport — LLM contracts', () => {
  it('handoff report is non-empty and marker-prefixed (fr)', { skip: SKIP, timeout: 20000 }, async () => {
    const out = await generateStaffReport(
      { kind: 'handoff', rule: 'négociation prix', message: 'je veux négocier' },
      'fr'
    );
    assert.ok(out.trim().length > 0, 'must not be empty');
    assert.ok(out.startsWith(STAFF_MARKER.handoff), 'must start with the handoff marker');
  });

  it('booking report stays concise (en)', { skip: SKIP, timeout: 20000 }, async () => {
    const out = await generateStaffReport(
      { kind: 'viewing_booked', title: 'Loft', slot: 'Mon 10:00', contact: 'Duc <d@x.fr>' },
      'en'
    );
    assert.ok(out.trim().length > 0);
    assert.ok(out.startsWith(STAFF_MARKER.viewing_booked));
    // Report-to-boss should be short — guard against a runaway essay.
    assert.ok(out.length < 600, `report unexpectedly long: ${out.length} chars`);
  });
});
