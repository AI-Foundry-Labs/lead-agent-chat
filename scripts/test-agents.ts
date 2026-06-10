/**
 * Internal agent action test suite.
 *
 * Phase 1 — Tool Presence: verify all expected tools are registered per agent
 *            type (no LLM call, instant).
 * Phase 2 — Integration: run prompts through runAgentTurn, capture tool_calls,
 *            verify at least one expected tool was invoked.
 *
 * Usage: tsx --env-file=.env scripts/test-agents.ts
 */
import { db, conversations, messages, leads, admins } from '../lib/db/client';
import { createConversation, getAgencyConfig, listListings } from '../lib/db';
import { runAgentTurn } from '../lib/agent/run';
import { buildMainAssistantTools } from '../lib/agent/tools/main-assistant-tools';
import { buildLeadTools } from '../lib/agent/tools/lead-tools';
import { eq, inArray } from 'drizzle-orm';
import type { AgentContext } from '../lib/agent/tools/context';

// ─── Phase 1: Expected tool catalog ──────────────────────────────────────────

const MAIN_ASSISTANT_EXPECTED_TOOLS = [
  'query_leads', 'search_leads', 'get_lead_detail', 'update_lead_info',
  'send_reply', 'draft_reply', 'take_over', 'release_conversation',
  'pipeline_summary', 'weekly_report', 'bulk_follow_up',
  'list_listings', 'create_listing', 'update_listing',
  'list_viewings', 'list_available_slots',
  'trigger_operator_briefing', 'trigger_lead_turn',
  'list_handoff_rules', 'create_handoff_rule', 'toggle_handoff_rule', 'delete_handoff_rule',
  'update_criteria', 'update_config'
];

const LEAD_EXPECTED_TOOLS = [
  'get_listing', 'search_listings',
  'record_qualification',
  'get_available_slots', 'book_viewing',
  'request_handoff',
  'remember_visitor_fact',
  'suggest_telegram_chat',
  'notify_admin'
];

// ─── Phase 2: Integration test cases ─────────────────────────────────────────

interface IntegrationCase {
  name: string;
  agentType: 'main_assistant' | 'lead';
  prompt: string;
  expectedTools: string[]; // at least one must be called
}

const INTEGRATION_TESTS: IntegrationCase[] = [
  // Admin — prompts that require fresh DB data, can't be answered from context
  {
    name: '[admin] search lead by email',
    agentType: 'main_assistant',
    prompt: 'Search for leads with email containing "test" — use the search tool',
    expectedTools: ['search_leads', 'query_leads']
  },
  {
    name: '[admin] list viewings with full details',
    agentType: 'main_assistant',
    // Snapshot only shows count — asking for IDs/calendar_event forces list_viewings
    prompt: 'Use list_viewings to show me all booked viewings with their IDs and calendar event info',
    expectedTools: ['list_viewings']
  },
  {
    name: '[admin] bulk follow-up warm leads',
    agentType: 'main_assistant',
    // Include message content so agent can call bulk_follow_up immediately
    prompt: 'Send this follow-up to all warm leads inactive for 3+ days: "Bonjour, nous souhaitons vous recontacter au sujet de votre projet immobilier. Êtes-vous toujours intéressé?"',
    expectedTools: ['bulk_follow_up']
  },
  // Lead agent
  {
    name: '[lead] search listings',
    agentType: 'lead',
    prompt: 'I am looking for a 2-bedroom apartment under 500,000 euros',
    expectedTools: ['search_listings', 'get_listing']
  },
  {
    name: '[lead] record qualification budget',
    agentType: 'lead',
    prompt: 'My budget is around 450,000 euros and I have pre-approved financing',
    expectedTools: ['record_qualification']
  },
  {
    name: '[lead] get slots after identification',
    agentType: 'lead',
    prompt: 'Hi, I am Sophie, my email is sophie.test@example.com. I would like to visit this property — when are you available?',
    expectedTools: ['get_available_slots', 'remember_visitor_fact']
  },
  {
    name: '[lead] remember visitor fact',
    agentType: 'lead',
    prompt: 'Just so you know, I am looking to buy within the next 2 months and I am the sole decision maker',
    expectedTools: ['remember_visitor_fact', 'record_qualification']
  }
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const createdConvIds: string[] = [];
const createdLeadIds: string[] = [];

async function cleanup() {
  if (createdConvIds.length)
    await db.delete(conversations).where(inArray(conversations.id, createdConvIds));
  if (createdLeadIds.length)
    await db.delete(leads).where(inArray(leads.id, createdLeadIds));
}

function extractToolCalls(toolCalls: unknown): string[] {
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls
    .map((tc: { toolName?: string; name?: string }) => tc.toolName ?? tc.name ?? '')
    .filter(Boolean);
}

// ─── Phase 1 runner ───────────────────────────────────────────────────────────

interface PresenceResult {
  agent: string;
  tool: string;
  present: boolean;
}

async function runPresenceTests(
  adminId: string,
  listingId: string | null,
  config: Awaited<ReturnType<typeof getAgencyConfig>>
): Promise<PresenceResult[]> {
  const results: PresenceResult[] = [];

  // Minimal mock context (no DB calls — just validates tool registration)
  const mockCtx = {
    conversation: {
      id: 'mock', type: 'main_assistant', lead_id: null, admin_id: adminId,
      listing_id: null, primary_channel: 'web', mode: 'agent',
      thread_summary: null, summarized_turn_count: 0,
      created_at: new Date(), updated_at: new Date()
    },
    config: config!
  } as AgentContext;

  const adminTools = buildMainAssistantTools(
    mockCtx, adminId, 'Test', async () => ({ reply: '' })
  );
  const adminToolNames = Object.keys(adminTools);

  for (const tool of MAIN_ASSISTANT_EXPECTED_TOOLS) {
    results.push({ agent: 'main_assistant', tool, present: adminToolNames.includes(tool) });
  }

  const leadMockCtx = {
    ...mockCtx,
    conversation: { ...mockCtx.conversation, type: 'lead', listing_id: listingId }
  } as AgentContext;
  const leadTools = buildLeadTools(leadMockCtx);
  const leadToolNames = Object.keys(leadTools);

  for (const tool of LEAD_EXPECTED_TOOLS) {
    results.push({ agent: 'lead', tool, present: leadToolNames.includes(tool) });
  }

  return results;
}

// ─── Phase 2 runner ───────────────────────────────────────────────────────────

interface IntegrationResult {
  name: string;
  passed: boolean;
  toolsCalled: string[];
  expectedTools: string[];
  reply: string;
  error?: string;
  durationMs: number;
}

async function runIntegrationTest(
  tc: IntegrationCase,
  adminId: string,
  listingId: string | null
): Promise<IntegrationResult> {
  const t0 = Date.now();
  const toolsCalled: string[] = [];
  let reply = '';

  try {
    const conv = await createConversation({
      type: tc.agentType === 'main_assistant' ? 'main_assistant' : 'lead',
      admin_id: tc.agentType === 'main_assistant' ? adminId : null,
      listing_id: tc.agentType === 'lead' ? listingId : null,
      primary_channel: 'web'
    });
    createdConvIds.push(conv.id);

    if (tc.agentType === 'lead') {
      const [leadRow] = await db
        .insert(leads)
        .values({ channel: 'web', email: null, name: null, listing_id: listingId, language: 'en', status: 'active', qual_values: {} })
        .returning();
      createdLeadIds.push(leadRow.id);
      await db.update(conversations).set({ lead_id: leadRow.id }).where(eq(conversations.id, conv.id));
    }

    const actor =
      tc.agentType === 'main_assistant'
        ? { type: 'main_assistant' as const, adminId, adminName: 'Test Admin' }
        : { type: 'lead' as const };

    const result = await runAgentTurn(conv.id, tc.prompt, actor, 'en');
    reply = result.reply;

    const allMsgs = await db.select().from(messages).where(eq(messages.conversation_id, conv.id));
    for (const msg of allMsgs) {
      if (msg.tool_calls) toolsCalled.push(...extractToolCalls(msg.tool_calls));
    }

    const passed = tc.expectedTools.some((t) => toolsCalled.includes(t));
    return { name: tc.name, passed, toolsCalled, expectedTools: tc.expectedTools, reply: reply.slice(0, 180), durationMs: Date.now() - t0 };
  } catch (err) {
    return { name: tc.name, passed: false, toolsCalled, expectedTools: tc.expectedTools, reply, error: String(err), durationMs: Date.now() - t0 };
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║        Agent Action Test Suite               ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  const config = await getAgencyConfig();
  if (!config) { console.error('✗ No agency config — run: npm run db:seed'); process.exit(1); }
  const [adminRow] = await db.select().from(admins).limit(1);
  if (!adminRow) { console.error('✗ No admin — run: npm run db:seed'); process.exit(1); }
  const allListings = await listListings();
  const listingId = allListings[0]?.id ?? null;

  console.log(`Config: ${config.name} | Admin: ${adminRow.name ?? adminRow.email} | Listing: ${listingId ?? 'none'}\n`);

  // ── Phase 1: Tool Presence ────────────────────────────────────────────────
  console.log('━━━ Phase 1: Tool Presence (no LLM) ━━━━━━━━━━━━━━━━━━━━━━━━\n');
  const presenceResults = await runPresenceTests(adminRow.id, listingId, config);
  let presencePassed = 0;
  const presenceFailed: PresenceResult[] = [];

  for (const r of presenceResults) {
    if (r.present) {
      presencePassed++;
    } else {
      presenceFailed.push(r);
      console.log(`  ✗ [${r.agent}] missing tool: ${r.tool}`);
    }
  }

  if (presenceFailed.length === 0) {
    console.log(`  ✓ All ${presenceResults.length} tools registered (main_assistant: ${MAIN_ASSISTANT_EXPECTED_TOOLS.length}, lead: ${LEAD_EXPECTED_TOOLS.length})\n`);
  } else {
    console.log(`\n  ${presencePassed}/${presenceResults.length} tools registered\n`);
  }

  // ── Phase 2: Integration ──────────────────────────────────────────────────
  console.log('━━━ Phase 2: Integration (real LLM) ━━━━━━━━━━━━━━━━━━━━━━━━\n');
  const integrationResults: IntegrationResult[] = [];

  for (let i = 0; i < INTEGRATION_TESTS.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1200));
    const tc = INTEGRATION_TESTS[i];
    process.stdout.write(`  ${tc.name} ... `);
    const result = await runIntegrationTest(tc, adminRow.id, listingId);
    integrationResults.push(result);

    if (result.passed) {
      console.log(`✓ PASS  [${result.durationMs}ms]`);
      console.log(`    Tools: ${result.toolsCalled.join(', ')}`);
    } else {
      console.log(`✗ FAIL  [${result.durationMs}ms]`);
      if (result.error) console.log(`    Error:    ${result.error}`);
      console.log(`    Expected: ${result.expectedTools.join(' | ')}`);
      console.log(`    Got:      ${result.toolsCalled.join(', ') || '(none)'}`);
    }
    console.log(`    Reply: "${result.reply.slice(0, 120)}..."\n`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const intPassed = integrationResults.filter((r) => r.passed).length;
  const intFailed = integrationResults.filter((r) => !r.passed).length;
  const presTotal = presenceResults.length;

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(`Phase 1 Tool Presence:  ${presencePassed}/${presTotal} ✓`);
  console.log(`Phase 2 Integration:    ${intPassed}/${integrationResults.length} ✓`);
  console.log(`Overall:                ${presencePassed + intPassed}/${presTotal + integrationResults.length} ✓\n`);

  console.log('Cleaning up test data...');
  await cleanup();
  console.log('Done.\n');

  process.exit(intFailed > 0 || presenceFailed.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Fatal:', e);
  cleanup().finally(() => process.exit(1));
});
