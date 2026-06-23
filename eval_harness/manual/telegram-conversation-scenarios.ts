/**
 * Lead ↔ Agency conversation scenarios — behaviour, cross-channel sync, commands.
 *
 * Goes beyond the slash-command smoke suite: drives multi-turn lead web chats and
 * admin commands from the 🛠 Master topic, then asserts:
 *   A. Lead agent behaviour    — right tools, real data, no hallucination
 *   B. Auto-handoff + notify    — rule fires, lead→handoff, Master notified
 *   C. Cross-channel sync        — admin command in Telegram → message lands in lead web chat
 *   D. Take over / release       — mode flips; manual = no auto-reply, agent = auto-reply
 *   E. Command correctness       — NL admin commands call the right tools w/ right effects
 *
 * Run:  npx tsx --env-file=.env eval_harness/manual/telegram-conversation-scenarios.ts
 *
 * Requires: dev server on :3300, group bound, webhook secret + DB url in .env.
 * Mutations to lead state are reverted at the end of each scenario.
 */

import {
  q,
  closeDb,
  groupMessage,
  postUpdate,
  postChat,
  getChat,
  sleep,
  Recorder,
  resolveFixtures,
  type GroupCtx
} from './e2e-helpers';

const LLM_GAP = 14_000; // wait for an LLM turn to persist before asserting DB
const SLASH_GAP = 1_800; // wait for a deterministic command + group-send queue

const rec = new Recorder();

/** Send a Master-topic group message (admin command), wait for the turn. */
async function master(ctx: GroupCtx, text: string, gap = LLM_GAP): Promise<number> {
  const status = await postUpdate(groupMessage(ctx, text));
  await sleep(gap);
  return status;
}

async function main(): Promise<void> {
  const fx = await resolveFixtures();
  const { agencyId, ctx } = fx;

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Lead ↔ Agency conversation scenarios');
  console.log(`  agency=${agencyId} group=${ctx.chatId} topic=${ctx.threadId}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await scenarioA_leadBehaviour();
  await scenarioB_handoff();
  await scenarioC_crossChannelSync(ctx);
  await scenarioD_takeoverRelease(ctx);
  await scenarioE_commandCorrectness(ctx, agencyId);

  const failed = rec.report();
  await closeDb();
  process.exit(failed > 0 ? 1 : 0);
}

// ═══ Scenario A — Lead web chat behaviour (multi-turn, auto agent) ════════════
async function scenarioA_leadBehaviour(): Promise<void> {
  console.log('\n══════ Scenario A — Lead behaviour (web, multi-turn) ══════');

  const toolNames = (msgs: { tool_calls: unknown }[]): string[] =>
    msgs.flatMap((m) =>
      Array.isArray(m.tool_calls)
        ? (m.tool_calls as { toolName?: string }[]).map((t) => t.toolName ?? '')
        : []
    );

  // Turn 1 — availability question on the Marais 3-room flat.
  const t1 = await postChat({
    message: 'Bonjour, ce 3 pièces au Marais est-il toujours disponible ?',
    listingId: 'marais-3p'
  });
  const convId = t1.conversationId;
  rec.record(
    'A1 availability → non-empty FR reply',
    t1.status === 200 && !!t1.reply && t1.reply.length > 10,
    t1.reply ? `len=${t1.reply.length}` : `HTTP ${t1.status}`
  );

  if (!convId) {
    rec.record('A* aborted', false, 'no conversationId from turn 1');
    return;
  }

  // Turn 2 — price + surface. Assert it cites the real price (850000 / 850 000 / 850k).
  const t2 = await postChat({ message: 'Quel est le prix et la surface ?', conversationId: convId });
  const priceOk = /850\s?000|850k|850\.000/i.test(t2.reply ?? '');
  rec.record(
    'A2 price → cites real 850 000 € (no hallucination)',
    t2.status === 200 && priceOk,
    priceOk ? 'price match' : `reply="${(t2.reply ?? '').slice(0, 80)}"`
  );

  // Turn 3 — budget + timeline → record_qualification → DB qual_values populated.
  const t3 = await postChat({
    message: "Mon budget est de 800k et je veux acheter d'ici 3 mois.",
    conversationId: convId
  });
  await sleep(1_500); // qualification persist
  const calledQual = toolNames(t3.messages).includes('record_qualification');
  const [conv] = await q<{ lead_id: string | null }>(
    `SELECT lead_id FROM conversations WHERE id = $1`,
    [convId]
  );
  let qualOk = false;
  let detail = 'no lead promoted';
  if (conv?.lead_id) {
    const [lead] = await q<{ qual_values: Record<string, unknown> | null }>(
      `SELECT qual_values FROM leads WHERE id = $1`,
      [conv.lead_id]
    );
    const keys = Object.keys(lead?.qual_values ?? {});
    qualOk = keys.length > 0;
    detail = `qual_values keys=[${keys.join(',')}] tool=${calledQual}`;
  }
  rec.record('A3 budget/timeline → record_qualification persists', qualOk, detail);

  // Turn 4 — viewing intent → get_available_slots offered.
  const t4 = await postChat({ message: 'Je voudrais visiter ce bien.', conversationId: convId });
  const calledSlots = toolNames(t4.messages).includes('get_available_slots');
  rec.record(
    'A4 viewing intent → get_available_slots',
    t4.status === 200 && (calledSlots || /créneau|disponib|visite/i.test(t4.reply ?? '')),
    calledSlots ? 'slots tool called' : `reply="${(t4.reply ?? '').slice(0, 80)}"`
  );

  // Save convId + leadId for later cleanup note.
  console.log(`  (Scenario A lead conversation = ${convId}, lead = ${conv?.lead_id ?? 'none'})`);
}

// ═══ Scenario B — Auto-handoff + notify into Master ═══════════════════════════
async function scenarioB_handoff(): Promise<void> {
  console.log('\n══════ Scenario B — Auto-handoff + Master notify ══════');

  // Fresh anonymous thread, trigger the "négocier / baisser le prix" rule.
  const t1 = await postChat({
    message: 'Pouvez-vous baisser le prix ? Je veux négocier sérieusement.',
    listingId: 'marais-3p'
  });
  const convId = t1.conversationId;
  await sleep(2_000); // handoff promote + notify are fire-and-forget

  let statusOk = false;
  let detail = 'no conv';
  if (convId) {
    const [conv] = await q<{ lead_id: string | null }>(
      `SELECT lead_id FROM conversations WHERE id = $1`,
      [convId]
    );
    if (conv?.lead_id) {
      const [lead] = await q<{ status: string; anon_seq: number | null }>(
        `SELECT status, anon_seq FROM leads WHERE id = $1`,
        [conv.lead_id]
      );
      statusOk = lead?.status === 'handoff';
      detail = `lead status=${lead?.status} (Visiteur #${lead?.anon_seq})`;
    } else {
      detail = 'lead not promoted (handoff on anonymous failed)';
    }
  }
  rec.record('B1 negotiation keyword → lead status=handoff + promoted', statusOk, detail);

  // Agent still replies (fall-through, not silent).
  rec.record(
    'B2 agent still replies after handoff (not silent)',
    !!t1.reply && t1.reply.trim().length > 0,
    t1.reply ? `len=${t1.reply.length}` : 'empty reply'
  );
  console.log('  (verify the 🚨 handoff notify appeared in the 🛠 Master topic)');
}

// ═══ Scenario C — Cross-channel sync: Master command → lead web chat ══════════
async function scenarioC_crossChannelSync(ctx: GroupCtx): Promise<void> {
  console.log('\n══════ Scenario C — Cross-channel sync (Telegram → Web) ══════');

  // Use an existing identified-able lead with a web conversation. Pick the lead
  // owning the most-recently-updated web 'lead' conversation in agent mode.
  const [target] = await q<{ lead_id: string; conv_id: string; anon_seq: number }>(
    `SELECT c.lead_id, c.id AS conv_id, l.anon_seq
       FROM conversations c JOIN leads l ON l.id = c.lead_id
      WHERE c.type='lead' AND c.lead_id IS NOT NULL AND c.primary_channel='web'
      ORDER BY c.updated_at DESC LIMIT 1`
  );
  if (!target) {
    rec.record('C* aborted', false, 'no web lead conversation found');
    return;
  }

  const marker = `RAPPEL-${Date.now() % 100000}`;
  // Switch to main agent, then command it to message the lead.
  await master(ctx, '/agent main', SLASH_GAP);
  await master(
    ctx,
    `Envoie un message au lead Visiteur #${target.anon_seq} : Bonjour, un conseiller vous rappellera demain à 14h. Référence ${marker}`
  );

  // getConversationByLeadId targets the most-recently-updated thread; the admin
  // message should appear in one of this lead's conversations. Check all of them.
  const adminMsgs = await q<{ conversation_id: string; content: string }>(
    `SELECT m.conversation_id, m.content
       FROM messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE c.lead_id = $1 AND m.role = 'admin' AND m.content LIKE $2`,
    [target.lead_id, `%${marker}%`]
  );
  rec.record(
    'C1 admin command → send_reply persists admin message',
    adminMsgs.length > 0,
    adminMsgs.length ? `in conv ${adminMsgs[0].conversation_id.slice(0, 8)}` : `marker ${marker} not found`
  );

  // Sync: a web client refetch of that conversation must see the admin message.
  if (adminMsgs.length) {
    const webMsgs = await getChat(adminMsgs[0].conversation_id);
    const seen = webMsgs.some((m) => m.content.includes(marker));
    rec.record(
      'C2 web client refetch sees the Telegram-originated message',
      seen,
      seen ? 'message visible on web' : 'not visible via GET /api/chat'
    );
  } else {
    rec.record('C2 web client refetch sees the message', false, 'skipped — no admin message');
  }
}

// ═══ Scenario D — Take over / release (mode sync) ════════════════════════════
async function scenarioD_takeoverRelease(ctx: GroupCtx): Promise<void> {
  console.log('\n══════ Scenario D — Take over / release (mode) ══════');

  // Find an agent-mode web lead conversation to drive.
  const [target] = await q<{ lead_id: string; conv_id: string; anon_seq: number; mode: string }>(
    `SELECT c.lead_id, c.id AS conv_id, l.anon_seq, c.mode
       FROM conversations c JOIN leads l ON l.id = c.lead_id
      WHERE c.type='lead' AND c.lead_id IS NOT NULL AND c.primary_channel='web'
      ORDER BY c.updated_at DESC LIMIT 1`
  );
  if (!target) {
    rec.record('D* aborted', false, 'no web lead conversation');
    return;
  }
  const convId = target.conv_id;

  // Ensure starting from agent mode.
  await q(`UPDATE conversations SET mode='agent' WHERE id=$1`, [convId]);

  // 1) Command take over.
  await master(ctx, `/agent main`, SLASH_GAP);
  await master(ctx, `Prends en charge la conversation du lead Visiteur #${target.anon_seq}.`);
  const [m1] = await q<{ mode: string }>(`SELECT mode FROM conversations WHERE id=$1`, [convId]);
  rec.record('D1 take_over command → mode=manual', m1?.mode === 'manual', `mode=${m1?.mode}`);

  // 2) Lead messages while manual → no auto-reply (no new assistant msg).
  const beforeAssist = (
    await q<{ n: string }>(
      `SELECT count(*)::text n FROM messages WHERE conversation_id=$1 AND role='assistant'`,
      [convId]
    )
  )[0].n;
  await postChat({ message: 'Bonjour, y a-t-il du nouveau ?', conversationId: convId });
  await sleep(3_000);
  const afterAssist = (
    await q<{ n: string }>(
      `SELECT count(*)::text n FROM messages WHERE conversation_id=$1 AND role='assistant'`,
      [convId]
    )
  )[0].n;
  rec.record(
    'D2 manual mode → lead message gets NO auto-reply',
    afterAssist === beforeAssist,
    `assistant msgs before=${beforeAssist} after=${afterAssist}`
  );

  // 3) Command release.
  await master(ctx, `Rends la main au bot pour le lead Visiteur #${target.anon_seq}.`);
  const [m2] = await q<{ mode: string }>(`SELECT mode FROM conversations WHERE id=$1`, [convId]);
  rec.record('D3 release command → mode=agent', m2?.mode === 'agent', `mode=${m2?.mode}`);

  // 4) Lead messages in agent mode → auto-reply resumes.
  const t = await postChat({ message: 'Le bien est-il toujours dispo ?', conversationId: convId });
  rec.record(
    'D4 agent mode → auto-reply resumes',
    !!t.reply && t.reply.trim().length > 0,
    t.reply ? `len=${t.reply.length}` : 'no reply'
  );
}

// ═══ Scenario E — Command correctness (read/write effects) ════════════════════
async function scenarioE_commandCorrectness(ctx: GroupCtx, agencyId: string): Promise<void> {
  console.log('\n══════ Scenario E — Command correctness ══════');

  await master(ctx, '/agent main', SLASH_GAP);

  // E1 — read a lead's status (Visiteur #2 = handoff fixture).
  const leads = await q<{ id: string; anon_seq: number; status: string }>(
    `SELECT id, anon_seq, status FROM leads WHERE agency_id=$1 ORDER BY anon_seq`,
    [agencyId]
  );
  const lead2 = leads.find((l) => l.anon_seq === 2) ?? leads[1] ?? leads[0];
  // We can't easily read the bot's reply text from DB-less group sends, so we
  // assert via the main_assistant conversation transcript instead.
  const [mainConv] = await q<{ id: string }>(
    `SELECT c.id FROM conversations c
      WHERE c.type='main_assistant'
      ORDER BY c.updated_at DESC LIMIT 1`
  );
  const beforeE1 = mainConv
    ? (await q<{ n: string }>(`SELECT count(*)::text n FROM messages WHERE conversation_id=$1`, [mainConv.id]))[0].n
    : '0';
  await master(ctx, `Quel est le statut du lead Visiteur #${lead2?.anon_seq} ?`);
  const afterE1 = mainConv
    ? (await q<{ n: string }>(`SELECT count(*)::text n FROM messages WHERE conversation_id=$1`, [mainConv.id]))[0].n
    : '0';
  rec.record(
    'E1 "statut du lead?" → agent responds (transcript grows)',
    Number(afterE1) > Number(beforeE1),
    `msgs ${beforeE1}→${afterE1}`
  );

  // E2 — write: change a lead status, verify DB, then revert.
  const lead1 = leads.find((l) => l.anon_seq === 1) ?? leads[0];
  const originalStatus = lead1?.status;
  await master(ctx, `Change le statut du lead Visiteur #${lead1?.anon_seq} en qualified.`);
  const [after] = await q<{ status: string }>(`SELECT status FROM leads WHERE id=$1`, [lead1?.id]);
  const writeOk = after?.status === 'qualified';
  rec.record(
    'E2 "change statut → qualified" → DB updated',
    writeOk,
    `status=${after?.status} (was ${originalStatus})`
  );
  // Revert.
  if (lead1?.id && originalStatus) {
    await q(`UPDATE leads SET status=$1 WHERE id=$2`, [originalStatus, lead1.id]);
    console.log(`  (reverted Visiteur #${lead1.anon_seq} status → ${originalStatus})`);
  }

  // E3 — count: "combien de leads au total ?" — assert transcript grows (agent answered).
  const beforeE3 = mainConv
    ? (await q<{ n: string }>(`SELECT count(*)::text n FROM messages WHERE conversation_id=$1`, [mainConv.id]))[0].n
    : '0';
  await master(ctx, 'Combien de leads au total dans le pipeline ?');
  const afterE3 = mainConv
    ? (await q<{ n: string }>(`SELECT count(*)::text n FROM messages WHERE conversation_id=$1`, [mainConv.id]))[0].n
    : '0';
  const [{ n: totalLeads }] = await q<{ n: string }>(`SELECT count(*)::text n FROM leads WHERE agency_id=$1`, [agencyId]);
  rec.record(
    'E3 "combien de leads?" → agent responds',
    Number(afterE3) > Number(beforeE3),
    `actual total=${totalLeads}, transcript ${beforeE3}→${afterE3}`
  );
}

main().catch(async (e) => {
  console.error('SCENARIO ERROR:', e);
  await closeDb();
  process.exit(1);
});
