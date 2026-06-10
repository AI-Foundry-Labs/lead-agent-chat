/**
 * Verify TOOL-FIRST behavior: a fuzzy "find lead named X" should trigger a search
 * (and the agent proposes the match) instead of bouncing a vague question back.
 *
 * Usage: tsx --env-file=.env scripts/test-tool-first.ts
 */
import { db, conversations, messages, leads, admins } from '../lib/db/client';
import { createConversation, getAgencyConfig } from '../lib/db';
import { runAgentTurn } from '../lib/agent/run';
import { eq, inArray } from 'drizzle-orm';

const convIds: string[] = [];
const leadIds: string[] = [];

function toolsOf(tc: unknown): string[] {
  if (!Array.isArray(tc)) return [];
  return tc.map((c: { toolName?: string }) => c.toolName ?? '').filter(Boolean);
}

async function main() {
  const config = await getAgencyConfig();
  const [admin] = await db.select().from(admins).limit(1);
  if (!config || !admin) { console.error('run db:seed'); process.exit(1); }

  // Seed a lead whose name partially matches "truong"
  const [lead] = await db.insert(leads).values({
    channel: 'web', email: 'thanhtruongtran@gmail.com', name: 'Tran Thanh Truong',
    listing_id: null, language: 'en', status: 'active', qual_values: {}
  }).returning();
  leadIds.push(lead.id);

  const conv = await createConversation({ type: 'main_assistant', admin_id: admin.id, primary_channel: 'web' });
  convIds.push(conv.id);

  const r = await runAgentTurn(
    conv.id,
    'tìm lead tên truong',
    { type: 'main_assistant', adminId: admin.id, adminName: admin.name },
    'en'
  );

  const msgs = await db.select().from(messages).where(eq(messages.conversation_id, conv.id));
  const called = msgs.flatMap((m) => toolsOf(m.tool_calls));
  const searched = called.includes('search_leads') || called.includes('query_leads');
  const suggestsEmail = r.reply.toLowerCase().includes('thanhtruongtran');

  console.log('\n=== TOOL-FIRST test: "tìm lead tên truong" ===');
  console.log(`Tools called: ${called.join(', ') || '(none)'}`);
  console.log(`Searched first: ${searched ? '✓' : '✗'}`);
  console.log(`Proposed the concrete match (email): ${suggestsEmail ? '✓' : '✗'}`);
  console.log(`Reply: "${r.reply.slice(0, 200)}"`);

  await db.delete(messages).where(inArray(messages.conversation_id, convIds));
  await db.delete(conversations).where(inArray(conversations.id, convIds));
  await db.delete(leads).where(inArray(leads.id, leadIds));
  console.log('\nCleaned up.');
  process.exit(searched ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
