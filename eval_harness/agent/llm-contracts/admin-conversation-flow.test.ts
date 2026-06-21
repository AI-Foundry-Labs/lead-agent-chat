/**
 * LLM contract tests — admin/operator ↔ agent conversation flow.
 * Simulates an admin querying and managing a lead via the operator agent.
 * No DB: tools are mocked; system prompt is built inline (avoids DB-dependent
 * buildOperatorSystemPrompt which calls buildLeadThreadsReportBlock).
 *
 * Run: ./eval_harness/run-tests.sh llm
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateText, tool, stepCountIs } from 'ai';
import { z } from 'zod';
import { AGENCY_CONFIG, IDENTIFIED_LEAD } from './test-fixtures.ts';

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

// Inline operator system prompt — mirrors the structure of buildOperatorSystemPrompt
// but without DB calls so it works in the test harness.
function buildTestOperatorPrompt(adminName: string): string {
  const lead = IDENTIFIED_LEAD;
  return `[ROLE]
You are the dedicated AI agent for lead ${lead.name} at ${AGENCY_CONFIG.name}.
You are speaking with admin ${adminName}. Replies here are INTERNAL — not sent to the customer.
To message the customer you must call send_reply explicitly.

[LEAD PROFILE]
id: ${lead.id}
name: ${lead.name}
email: ${lead.email}
status: ${lead.status}
potential: ${lead.potential_status ?? 'unscored'}
qualification: ${JSON.stringify(lead.qual_values)}

[VISITOR THREADS]
- conversation_id:conv-test-001 · web · Appartement Marais · mode:agent · updated:2026-06-14
  Summary: Lead expressed interest, stated budget 750k€. Waiting for viewing proposal.

[OPERATOR RULES]
Use tools when they can resolve the request. Give clear, specific answers.
Before sending a message to the customer, call send_reply with the conversation_id.`;
}

// Mock operator tools — no DB, return fixture responses.
const MOCK_OPERATOR_TOOLS = {
  get_lead_viewings: tool({
    description: 'List all viewings booked for this lead.',
    inputSchema: z.object({}),
    execute: async () => ({ viewings: [] }),
  }),
  update_lead_status: tool({
    description: 'Update lead potential (hot/warm/cold) or lifecycle status.',
    inputSchema: z.object({
      lead_id:          z.string().optional(),
      potential_status: z.enum(['hot', 'warm', 'cold']).optional(),
      status:           z.enum(['active', 'qualified', 'booked', 'handoff', 'abandoned']).optional(),
      memory_note:      z.string().max(600).optional(),
    }),
    execute: async (args) => ({ updated: true, ...args }),
  }),
  send_reply: tool({
    description: 'Send a message to the visitor on their channel.',
    inputSchema: z.object({
      conversation_id: z.string(),
      content:         z.string(),
    }),
    execute: async ({ conversation_id, content }) => ({ sent: true, conversation_id, preview: content.slice(0, 80) }),
  }),
  remember_visitor_fact: tool({
    description: 'Append durable facts to lead long-term memory.',
    inputSchema: z.object({ facts: z.array(z.string().max(800)).min(1).max(20) }),
    execute: async () => ({ stored: true }),
  }),
  record_qualification: tool({
    description: 'Record qualification values and update lead potential.',
    inputSchema: z.object({
      lead_id:          z.string().optional(),
      values:           z.record(z.string(), z.string()),
      potential_status: z.enum(['hot', 'warm', 'cold']),
      reason:           z.string().max(200),
    }),
    execute: async () => ({ recorded: true }),
  }),
};

describe('admin ↔ agent conversation flow', () => {
  it('agent summarises lead profile from context without tool call', { skip: SKIP, timeout: 25000 }, async () => {
    const { FAST_MODEL } = await import('../../../lib/llm.ts');
    const result = await generateText({
      model: FAST_MODEL,
      system: buildTestOperatorPrompt('Sophie'),
      messages: [{ role: 'user', content: 'Donne-moi un résumé du profil de Tarik.' }],
      tools: MOCK_OPERATOR_TOOLS,
      stopWhen: stepCountIs(5),
    });
    assert.ok(result.text.length > 0, 'agent must reply');
    // Profile data (name, budget, status) should appear in the response
    const mentionsLead = /tarik|750|warm|active/i.test(result.text);
    assert.ok(mentionsLead, `Reply should reference lead profile data. Got: "${result.text.slice(0, 300)}"`);
  });

  it('agent calls update_lead_status when admin requests a potential change', { skip: SKIP, timeout: 25000 }, async () => {
    const { FAST_MODEL } = await import('../../../lib/llm.ts');
    const result = await generateText({
      model: FAST_MODEL,
      system: buildTestOperatorPrompt('Sophie'),
      messages: [{ role: 'user', content: 'Mets Tarik en hot — il vient de confirmer son budget.' }],
      tools: MOCK_OPERATOR_TOOLS,
      stopWhen: stepCountIs(5),
    });
    const calledTools = result.steps.flatMap(s => s.toolCalls.map(tc => tc.toolName));
    assert.ok(
      calledTools.includes('update_lead_status'),
      `Expected update_lead_status call. Tools called: ${calledTools.join(', ')}`
    );
    // Verify the tool was called with potential_status='hot'
    const hotCall = result.steps
      .flatMap(s => s.toolCalls)
      .find(tc => tc.toolName === 'update_lead_status' && (tc.input as Record<string, unknown>).potential_status === 'hot');
    assert.ok(hotCall, 'update_lead_status must be called with potential_status="hot"');
  });

  it('agent calls get_lead_viewings when admin asks about booked visits', { skip: SKIP, timeout: 25000 }, async () => {
    const { FAST_MODEL } = await import('../../../lib/llm.ts');
    const result = await generateText({
      model: FAST_MODEL,
      system: buildTestOperatorPrompt('Sophie'),
      messages: [{ role: 'user', content: 'Est-ce que Tarik a des visites prévues ?' }],
      tools: MOCK_OPERATOR_TOOLS,
      stopWhen: stepCountIs(5),
    });
    const calledTools = result.steps.flatMap(s => s.toolCalls.map(tc => tc.toolName));
    assert.ok(
      calledTools.includes('get_lead_viewings'),
      `Expected get_lead_viewings call. Tools called: ${calledTools.join(', ')}`
    );
    assert.ok(result.text.length > 0, 'agent must reply after checking viewings');
  });

  it('agent calls send_reply when admin asks to message the visitor', { skip: SKIP, timeout: 30000 }, async () => {
    const { FAST_MODEL } = await import('../../../lib/llm.ts');
    const result = await generateText({
      model: FAST_MODEL,
      system: buildTestOperatorPrompt('Sophie'),
      messages: [{ role: 'user', content: 'Envoie un message à Tarik pour lui proposer une visite vendredi matin.' }],
      tools: MOCK_OPERATOR_TOOLS,
      stopWhen: stepCountIs(5),
    });
    const calledTools = result.steps.flatMap(s => s.toolCalls.map(tc => tc.toolName));
    assert.ok(
      calledTools.includes('send_reply'),
      `Expected send_reply call. Tools called: ${calledTools.join(', ')}`
    );
    const replyCall = result.steps
      .flatMap(s => s.toolCalls)
      .find(tc => tc.toolName === 'send_reply');
    assert.ok(
      (replyCall?.input as Record<string, unknown>)?.conversation_id === 'conv-test-001',
      `send_reply must use conversation_id from the threads list. Args: ${JSON.stringify(replyCall?.input)}`
    );
  });

  it('agent calls update_lead_status with abandoned when admin marks lead as lost', { skip: SKIP, timeout: 25000 }, async () => {
    const { FAST_MODEL } = await import('../../../lib/llm.ts');
    const result = await generateText({
      model: FAST_MODEL,
      system: buildTestOperatorPrompt('Sophie'),
      messages: [{ role: 'user', content: 'Tarik a trouvé un autre bien, marque-le comme abandonné.' }],
      tools: MOCK_OPERATOR_TOOLS,
      stopWhen: stepCountIs(5),
    });
    const calledTools = result.steps.flatMap(s => s.toolCalls.map(tc => tc.toolName));
    assert.ok(
      calledTools.includes('update_lead_status'),
      `Expected update_lead_status call. Tools called: ${calledTools.join(', ')}`
    );
    const call = result.steps.flatMap(s => s.toolCalls)
      .find(tc => tc.toolName === 'update_lead_status');
    assert.equal(
      (call?.input as Record<string, unknown>)?.status,
      'abandoned',
      `update_lead_status must be called with status="abandoned". Args: ${JSON.stringify(call?.input)}`
    );
  });

  it('agent calls remember_visitor_fact when admin provides context about the lead', { skip: SKIP, timeout: 25000 }, async () => {
    const { FAST_MODEL } = await import('../../../lib/llm.ts');
    const result = await generateText({
      model: FAST_MODEL,
      system: buildTestOperatorPrompt('Sophie'),
      messages: [{ role: 'user', content: 'Note que Tarik cherche un bien pour investissement locatif, pas pour y habiter.' }],
      tools: MOCK_OPERATOR_TOOLS,
      stopWhen: stepCountIs(5),
    });
    const calledTools = result.steps.flatMap(s => s.toolCalls.map(tc => tc.toolName));
    assert.ok(
      calledTools.includes('remember_visitor_fact') || calledTools.includes('record_qualification'),
      `Expected remember_visitor_fact or record_qualification. Tools called: ${calledTools.join(', ')}`
    );
  });

  it('agent does NOT call send_reply when admin asks for a draft only', { skip: SKIP, timeout: 25000 }, async () => {
    const { FAST_MODEL } = await import('../../../lib/llm.ts');
    const result = await generateText({
      model: FAST_MODEL,
      system: buildTestOperatorPrompt('Sophie'),
      messages: [{ role: 'user', content: 'Rédige un message pour proposer une visite à Tarik, mais ne l\'envoie pas encore.' }],
      tools: MOCK_OPERATOR_TOOLS,
      stopWhen: stepCountIs(5),
    });
    const calledTools = result.steps.flatMap(s => s.toolCalls.map(tc => tc.toolName));
    assert.ok(
      !calledTools.includes('send_reply'),
      `send_reply must NOT be called when admin asks for a draft only. Tools called: ${calledTools.join(', ')}`
    );
    assert.ok(result.text.length > 0, 'agent must produce the draft text');
  });
});
