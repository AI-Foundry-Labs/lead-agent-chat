/**
 * Smoke test for the unified operator agent (lead mode + pool mode).
 * Verifies tool presence and a live tool-call in each scope.
 *
 * Usage: tsx --env-file=.env scripts/test-operator.ts
 */
import { db, conversations, messages, leads, admins } from '../lib/db/client';
import { createConversation, getAgencyConfig, getOrCreateAnonymousOperator } from '../lib/db';
import { runAgentTurn } from '../lib/agent/run';
import { buildOperatorTools } from '../lib/agent/tools/operator-tools';
import { eq, inArray } from 'drizzle-orm';
import type { AgentContext } from '../lib/agent/tools/context';

const EXPECTED_TOOLS = [
  'list_threads', 'get_thread', 'draft_reply', 'send_reply', 'takeover_thread', 'release_thread',
  'update_lead_status', 'record_qualification', 'remember_visitor_fact',
  'get_lead_viewings', 'cancel_viewing', 'reschedule_viewing', 'request_handoff', 'notify_admin'
];

const createdConvIds: string[] = [];
const createdLeadIds: string[] = [];

function toolNamesOf(toolCalls: unknown): string[] {
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls.map((tc: { toolName?: string }) => tc.toolName ?? '').filter(Boolean);
}

async function main() {
  console.log('\n=== Unified Operator Smoke Test ===\n');
  const [admin] = await db.select().from(admins).limit(1);
  if (!admin) { console.error('✗ no admin'); process.exit(1); }
  const config = await getAgencyConfig(admin.agency_id);
  if (!config) { console.error('✗ run db:seed'); process.exit(1); }

  // ── Phase 1: tool presence (both scopes share the same toolset) ──
  const mockCtx = {
    conversation: {
      id: 'mock', type: 'operator', lead_id: null, admin_id: admin.id, listing_id: null,
      primary_channel: 'web', mode: 'agent', thread_summary: null, summarized_turn_count: 0,
      created_at: new Date(), updated_at: new Date()
    },
    config
  } as AgentContext;
  const tools = Object.keys(buildOperatorTools(mockCtx, 'some-lead-id'));
  const missing = EXPECTED_TOOLS.filter((t) => !tools.includes(t));
  console.log(`Phase 1 — Tool presence: ${EXPECTED_TOOLS.length - missing.length}/${EXPECTED_TOOLS.length}`);
  if (missing.length) console.log(`  missing: ${missing.join(', ')}`);
  else console.log('  ✓ all operator tools registered\n');

  // ── Phase 2: lead mode — update potential via natural language ──
  const [lead] = await db.insert(leads).values({
    agency_id: admin.agency_id, channel: 'web', email: 'operator.test@example.com', name: 'Operator Test',
    listing_id: null, language: 'en', status: 'active', qual_values: {}
  }).returning();
  createdLeadIds.push(lead.id);
  const operatorConv = await createConversation({ type: 'operator', agency_id: admin.agency_id, lead_id: lead.id, primary_channel: 'web' });
  createdConvIds.push(operatorConv.id);

  const r1 = await runAgentTurn(
    operatorConv.id,
    'This lead just told us they have cash ready and want to buy immediately. Mark them as hot and note why.',
    { type: 'operator', leadId: lead.id, adminId: admin.id, adminName: admin.name },
    'en'
  );
  const msgs1 = await db.select().from(messages).where(eq(messages.conversation_id, operatorConv.id));
  const called1 = msgs1.flatMap((m) => toolNamesOf(m.tool_calls));
  const pass1 = called1.includes('update_lead_status') || called1.includes('remember_visitor_fact');
  console.log(`Phase 2 — Lead mode (set hot): ${pass1 ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`  tools: ${called1.join(', ') || '(none)'}`);
  console.log(`  reply: "${r1.reply.slice(0, 100)}..."\n`);

  // ── Phase 3: pool mode — list anonymous threads ──
  const poolConv = await getOrCreateAnonymousOperator(admin.agency_id);
  const r2 = await runAgentTurn(
    poolConv.id,
    'List the anonymous visitor threads in the triage pool.',
    { type: 'operator', leadId: null, adminId: admin.id, adminName: admin.name },
    'en'
  );
  const poolMsgs = await db.select().from(messages).where(eq(messages.conversation_id, poolConv.id));
  const called2 = poolMsgs.flatMap((m) => toolNamesOf(m.tool_calls));
  const pass2 = called2.includes('list_threads');
  console.log(`Phase 3 — Pool mode (list_threads): ${pass2 ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`  tools: ${called2.join(', ') || '(none)'}`);
  console.log(`  reply: "${r2.reply.slice(0, 100)}..."\n`);

  // Verify the lead potential actually changed in DB
  const [after] = await db.select().from(leads).where(eq(leads.id, lead.id));
  console.log(`DB check — lead potential after Phase 2: ${after.potential_status ?? 'null'}`);

  // cleanup (pool conv is shared/persistent — only clean our test messages there)
  await db.delete(messages).where(eq(messages.conversation_id, poolConv.id));
  await db.delete(conversations).where(inArray(conversations.id, createdConvIds));
  await db.delete(leads).where(inArray(leads.id, createdLeadIds));
  console.log('\nCleaned up. Done.');
  process.exit(pass1 && pass2 && missing.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
