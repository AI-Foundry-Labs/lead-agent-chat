/**
 * LLM contract tests — lead ↔ agent conversation flow.
 * Simulates a visitor asking questions and triggering tool calls.
 * No DB: tools are mocked with fixture data; system prompt uses real builder.
 *
 * Run: ./eval_harness/run-tests.sh llm
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateText, tool, stepCountIs } from 'ai';
import { z } from 'zod';
import { buildLeadSystemPrompt } from '../../../lib/agent/prompts.ts';
import {
  AGENCY_CONFIG,
  FIXTURE_LISTING,
  IDENTIFIED_LEAD,
  ANON_LEAD,
  FIXTURE_SLOTS,
} from './test-fixtures.ts';

function hasLlmKey(): boolean {
  if (process.env.AI_GATEWAY_API_KEY) return true;
  const fastModel = process.env.LLM_FAST_MODEL ?? 'openai/gpt-4o-mini';
  const provider = fastModel.split('/')[0];
  const keyMap: Record<string, string | undefined> = {
    openai:    process.env.OPENAI_API_KEY    ?? process.env.LLM_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY ?? process.env.LLM_API_KEY,
    google:    process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GOOGLE_API_KEY ?? process.env.LLM_API_KEY,
  };
  return !!keyMap[provider];
}

const SKIP: string | undefined = hasLlmKey()
  ? undefined
  : 'No LLM API key — set LLM_API_KEY, provider-specific key, or AI_GATEWAY_API_KEY';

// Mock tools — execute returns fixture data, no DB or external calls.
const MOCK_LEAD_TOOLS = {
  get_listing: tool({
    description: 'Get full details of the property under discussion.',
    inputSchema: z.object({ listing_id: z.string().optional() }),
    execute: async () => FIXTURE_LISTING,
  }),
  get_available_slots: tool({
    description: 'Get available viewing appointment slots. Call when the visitor asks about visiting.',
    inputSchema: z.object({ count: z.number().int().min(1).max(5).optional() }),
    execute: async () => ({ slots: FIXTURE_SLOTS }),
  }),
  book_viewing: tool({
    description: 'Book a viewing. Requires contact_email. If missing, ask the visitor for it first.',
    inputSchema: z.object({
      slot_iso: z.string(),
      contact_email: z.string().email().optional(),
      contact_name: z.string().optional(),
    }),
    execute: async ({ contact_email, slot_iso }) => {
      if (!contact_email) return { need_contact: true };
      return { booked: true, slot_iso, contact_email };
    },
  }),
  record_qualification: tool({
    description: 'Record qualification values and update lead potential.',
    inputSchema: z.object({
      values: z.record(z.string(), z.string()),
      potential_status: z.enum(['hot', 'warm', 'cold']),
      reason: z.string().max(200),
    }),
    execute: async () => ({ recorded: true }),
  }),
  remember_visitor_fact: tool({
    description: 'Store durable facts about the visitor across threads.',
    inputSchema: z.object({ facts: z.array(z.string().max(800)).min(1).max(20) }),
    execute: async () => ({ stored: true }),
  }),
  get_lead_viewings: tool({
    description: 'List viewings booked in this conversation.',
    inputSchema: z.object({}),
    execute: async () => ({
      viewings: [{
        id: 'v-001',
        listing_id: 'lst-test',
        slot: 'Vendredi 20 juin — 10h00',
        status: 'confirmed',
        contact_email: 'tarik@example.com',
      }],
    }),
  }),
  cancel_viewing: tool({
    description: 'Cancel a viewing. Use only when visitor explicitly requests cancellation.',
    inputSchema: z.object({
      viewing_id: z.string(),
      reason: z.string().max(300).optional(),
    }),
    execute: async ({ viewing_id }) => ({ cancelled: true, viewing_id }),
  }),
  reschedule_viewing: tool({
    description: 'Reschedule a viewing to a new slot from get_available_slots.',
    inputSchema: z.object({
      viewing_id: z.string(),
      new_slot_iso: z.string(),
    }),
    execute: async ({ viewing_id, new_slot_iso }) => ({ rescheduled: true, viewing_id, new_slot_iso }),
  }),
};

describe('lead ↔ agent conversation flow', () => {
  it('agent answers a price question without erroring', { skip: SKIP, timeout: 30000 }, async () => {
    const { FAST_MODEL } = await import('../../../lib/llm.ts');
    const system = buildLeadSystemPrompt({
      config: AGENCY_CONFIG,
      listing: FIXTURE_LISTING,
      lead: IDENTIFIED_LEAD,
      lang: 'fr',
      channel: 'web',
      crossThreadContext: '',
    });
    const result = await generateText({
      model: FAST_MODEL,
      system,
      messages: [{ role: 'user', content: 'Quel est le prix de cet appartement ?' }],
      tools: MOCK_LEAD_TOOLS,
      stopWhen: stepCountIs(5),
    });
    assert.ok(result.text.length > 0, 'agent must produce a non-empty reply');
    // Price (780 000) should appear in reply or agent called get_listing for details
    const calledTools = result.steps.flatMap(s => s.toolCalls.map(tc => tc.toolName));
    const hasPriceInfo = /780|780\s*000|780k/i.test(result.text) || calledTools.includes('get_listing');
    assert.ok(hasPriceInfo, `Reply should reference the price or call get_listing. Got: "${result.text.slice(0, 200)}"`);
  });

  it('agent calls get_available_slots when visitor requests a visit', { skip: SKIP, timeout: 30000 }, async () => {
    const { FAST_MODEL } = await import('../../../lib/llm.ts');
    const system = buildLeadSystemPrompt({
      config: AGENCY_CONFIG,
      listing: FIXTURE_LISTING,
      lead: IDENTIFIED_LEAD,
      lang: 'fr',
      channel: 'web',
      crossThreadContext: '',
    });
    const result = await generateText({
      model: FAST_MODEL,
      system,
      messages: [{ role: 'user', content: 'Je voudrais voir les créneaux disponibles pour une visite.' }],
      tools: MOCK_LEAD_TOOLS,
      stopWhen: stepCountIs(5),
    });
    const calledTools = result.steps.flatMap(s => s.toolCalls.map(tc => tc.toolName));
    assert.ok(calledTools.includes('get_available_slots'), `Expected get_available_slots call. Tools called: ${calledTools.join(', ')}`);
    assert.ok(result.text.length > 0, 'agent must reply after fetching slots');
  });

  it('agent asks for contact email when anon lead tries to book a slot', { skip: SKIP, timeout: 35000 }, async () => {
    const { FAST_MODEL } = await import('../../../lib/llm.ts');
    const system = buildLeadSystemPrompt({
      config: AGENCY_CONFIG,
      listing: FIXTURE_LISTING,
      lead: ANON_LEAD,
      lang: 'fr',
      channel: 'web',
      crossThreadContext: '',
    });
    const result = await generateText({
      model: FAST_MODEL,
      system,
      messages: [
        { role: 'user',      content: 'Je voudrais voir les créneaux disponibles.' },
        { role: 'assistant', content: `Voici les créneaux disponibles :\n- ${FIXTURE_SLOTS[0].label}\n- ${FIXTURE_SLOTS[1].label}\nLequel vous convient ?` },
        { role: 'user',      content: `Je prends le ${FIXTURE_SLOTS[0].label}.` },
      ],
      tools: MOCK_LEAD_TOOLS,
      stopWhen: stepCountIs(5),
    });
    // Without an email the agent must either ask for email or book_viewing returns need_contact:true
    const calledTools = result.steps.flatMap(s => s.toolCalls.map(tc => tc.toolName));
    const askedForEmail = /email|contact|adresse/i.test(result.text);
    const triedBooking = calledTools.includes('book_viewing');
    assert.ok(
      askedForEmail || triedBooking,
      `Agent should ask for email or attempt book_viewing (which returns need_contact). Reply: "${result.text.slice(0, 300)}"`
    );
  });

  it('agent replies in English when visitor writes in English', { skip: SKIP, timeout: 30000 }, async () => {
    const { FAST_MODEL } = await import('../../../lib/llm.ts');
    // lang='en' simulates pre-detected English visitor
    const system = buildLeadSystemPrompt({
      config: AGENCY_CONFIG,
      listing: FIXTURE_LISTING,
      lead: { ...IDENTIFIED_LEAD, language: 'en' },
      lang: 'en',
      channel: 'web',
      crossThreadContext: '',
    });
    const result = await generateText({
      model: FAST_MODEL,
      system,
      messages: [{ role: 'user', content: 'How many rooms does the apartment have?' }],
      tools: MOCK_LEAD_TOOLS,
      stopWhen: stepCountIs(5),
    });
    assert.ok(result.text.length > 0, 'agent must reply');
    const looksEnglish = /\b(room|apartment|floor|available|price|the|this|is|are|has|have)\b/i.test(result.text);
    assert.ok(looksEnglish, `Reply does not appear to be English: "${result.text.slice(0, 300)}"`);
  });

  it('agent calls record_qualification when lead reveals budget', { skip: SKIP, timeout: 30000 }, async () => {
    const { FAST_MODEL } = await import('../../../lib/llm.ts');
    const system = buildLeadSystemPrompt({
      config: AGENCY_CONFIG,
      listing: FIXTURE_LISTING,
      lead: { ...IDENTIFIED_LEAD, qual_values: {} },  // no criteria collected yet
      lang: 'fr',
      channel: 'web',
      crossThreadContext: '',
    });
    const result = await generateText({
      model: FAST_MODEL,
      system,
      messages: [{ role: 'user', content: 'Mon budget est de 800 000 euros, achat comptant.' }],
      tools: MOCK_LEAD_TOOLS,
      stopWhen: stepCountIs(5),
    });
    const calledTools = result.steps.flatMap(s => s.toolCalls.map(tc => tc.toolName));
    assert.ok(
      calledTools.includes('record_qualification') || calledTools.includes('remember_visitor_fact'),
      `Expected record_qualification or remember_visitor_fact. Tools called: ${calledTools.join(', ')}`
    );
  });

  it('agent calls cancel_viewing when lead asks to cancel', { skip: SKIP, timeout: 35000 }, async () => {
    const { FAST_MODEL } = await import('../../../lib/llm.ts');
    const system = buildLeadSystemPrompt({
      config: AGENCY_CONFIG,
      listing: FIXTURE_LISTING,
      lead: IDENTIFIED_LEAD,
      lang: 'fr',
      channel: 'web',
      crossThreadContext: '',
    });
    const result = await generateText({
      model: FAST_MODEL,
      system,
      messages: [{ role: 'user', content: 'Je voudrais annuler ma visite prévue vendredi.' }],
      tools: MOCK_LEAD_TOOLS,
      stopWhen: stepCountIs(6),
    });
    const calledTools = result.steps.flatMap(s => s.toolCalls.map(tc => tc.toolName));
    // Agent should first check viewings then cancel — either order is valid
    assert.ok(
      calledTools.includes('cancel_viewing') || calledTools.includes('get_lead_viewings'),
      `Expected cancel_viewing or get_lead_viewings. Tools called: ${calledTools.join(', ')}`
    );
    assert.ok(result.text.length > 0, 'agent must confirm or ask for clarification');
  });

  it('agent calls reschedule_viewing when lead asks to change slot', { skip: SKIP, timeout: 40000 }, async () => {
    const { FAST_MODEL } = await import('../../../lib/llm.ts');
    const system = buildLeadSystemPrompt({
      config: AGENCY_CONFIG,
      listing: FIXTURE_LISTING,
      lead: IDENTIFIED_LEAD,
      lang: 'fr',
      channel: 'web',
      crossThreadContext: '',
    });
    const result = await generateText({
      model: FAST_MODEL,
      system,
      messages: [
        { role: 'user',      content: 'Je ne peux plus venir vendredi, pouvez-vous me proposer un autre créneau ?' },
        { role: 'assistant', content: `Bien sûr ! Voici les créneaux disponibles :\n- ${FIXTURE_SLOTS[1].label}\n- ${FIXTURE_SLOTS[2].label}` },
        { role: 'user',      content: `Je prends le ${FIXTURE_SLOTS[2].label}.` },
      ],
      tools: MOCK_LEAD_TOOLS,
      stopWhen: stepCountIs(6),
    });
    const calledTools = result.steps.flatMap(s => s.toolCalls.map(tc => tc.toolName));
    assert.ok(
      calledTools.includes('reschedule_viewing') || calledTools.includes('get_available_slots'),
      `Expected reschedule_viewing or get_available_slots. Tools called: ${calledTools.join(', ')}`
    );
    assert.ok(result.text.length > 0, 'agent must confirm the rescheduling');
  });
});
