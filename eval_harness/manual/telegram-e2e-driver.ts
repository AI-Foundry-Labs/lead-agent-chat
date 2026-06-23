/**
 * Telegram Master Agent — E2E driver.
 *
 * Drives every Master-topic slash command + one representative LLM turn per
 * agent type by POSTing synthetic Telegram `Update` JSON to /api/telegram
 * (same path the real webhook + telegram-dev long-poller use).
 *
 * The server processes each update exactly as a real webhook would, so the bot
 * posts REAL replies into the bound group and writes REAL side-effects to the DB.
 * Assertions are made against (1) HTTP status, (2) Postgres state.
 *
 * Run:  npx tsx --env-file=.env eval_harness/manual/telegram-e2e-driver.ts
 *       npx tsx --env-file=.env eval_harness/manual/telegram-e2e-driver.ts --no-llm
 *
 * Requires: dev server on :3300, group already bound (agencies row), webhook
 * secret in .env. Reads config from .env + Postgres at startup.
 */

import {
  BASE,
  q,
  closeDb,
  groupMessage,
  callbackQuery,
  postUpdate,
  sleep,
  Recorder,
  resolveFixtures,
  type GroupCtx
} from './e2e-helpers';

const RUN_LLM = !process.argv.includes('--no-llm');

const rec = new Recorder();
const record = (name: string, ok: boolean, detail = ''): void => rec.record(name, ok, detail);

/**
 * Send a group message, assert HTTP 200, then run an optional DB/state check.
 * `gap` ms wait afterwards lets the group-send-queue drain (throttle ~1/3s) and
 * gives LLM turns time to persist before the next DB assertion.
 */
async function step(
  name: string,
  update: object,
  opts: { gap?: number; check?: () => Promise<string | null> } = {}
): Promise<void> {
  console.log(`\n▶ ${name}`);
  let status: number;
  try {
    status = await postUpdate(update);
  } catch (e) {
    record(name, false, `POST threw: ${(e as Error).message}`);
    return;
  }
  if (status !== 200) {
    record(name, false, `HTTP ${status}`);
    return;
  }
  await sleep(opts.gap ?? 3_500);
  if (opts.check) {
    try {
      const fail = await opts.check();
      record(name, fail === null, fail ?? `HTTP 200`);
    } catch (e) {
      record(name, false, `check threw: ${(e as Error).message}`);
    }
  } else {
    record(name, true, 'HTTP 200');
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Resolve agency / group / leads / primary admin from DB (portable).
  const fx = await resolveFixtures();
  const agency = { id: fx.agencyId };
  const ctx: GroupCtx = fx.ctx;

  const leads = fx.leads;
  const lead1 = leads[0];
  const lead2 = leads[1] ?? leads[0];
  const primaryAdmin = { id: fx.primaryAdminId };

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Telegram Master Agent — E2E driver');
  console.log(`  base=${BASE}  group=${ctx.chatId}  topic=${ctx.threadId}`);
  console.log(`  agency=${agency.id}`);
  console.log(`  lead#${lead1?.anon_seq}=${lead1?.id}  lead#${lead2?.anon_seq}=${lead2?.id}`);
  console.log(`  primaryAdmin=${primaryAdmin?.id}  LLM=${RUN_LLM ? 'on' : 'off'}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const sessionKind = async (): Promise<{ kind: string | null; leadId: string | null }> => {
    const rows = await q<{ agent_kind: string; lead_id: string | null }>(
      `SELECT agent_kind, lead_id FROM telegram_agent_sessions WHERE agency_id = $1`,
      [agency.id]
    );
    return { kind: rows[0]?.agent_kind ?? null, leadId: rows[0]?.lead_id ?? null };
  };

  // ═══ SECTION 1: deterministic slash commands ═══════════════════════════════
  console.log('\n══════ SECTION 1: Slash commands (deterministic) ══════');

  await step('/help', groupMessage(ctx, '/help'), { gap: 3_500 });
  await step('/leads', groupMessage(ctx, '/leads'), { gap: 3_500 });
  await step('/leads hot', groupMessage(ctx, '/leads hot'), { gap: 3_500 });
  await step(`/lead ${lead2?.anon_seq}`, groupMessage(ctx, `/lead ${lead2?.anon_seq}`), { gap: 3_500 });
  await step(`/lead_history ${lead2?.anon_seq}`, groupMessage(ctx, `/lead_history ${lead2?.anon_seq}`), { gap: 3_500 });
  await step('/lead_history (no arg → picker)', groupMessage(ctx, '/lead_history'), { gap: 3_500 });
  await step('/pool', groupMessage(ctx, '/pool'), { gap: 3_500 });
  await step('/agent (picker)', groupMessage(ctx, '/agent'), { gap: 3_500 });

  // ═══ SECTION 2: /agent session switching (verify DB) ═══════════════════════
  console.log('\n══════ SECTION 2: /agent session switching ══════');

  await step('/agent main → session=main', groupMessage(ctx, '/agent main'), {
    gap: 1_500,
    check: async () => {
      const s = await sessionKind();
      return s.kind === 'main' ? null : `expected main, got ${s.kind}`;
    }
  });

  await step(`/agent lead ${lead1?.anon_seq} → session=operator`, groupMessage(ctx, `/agent lead ${lead1?.anon_seq}`), {
    gap: 1_500,
    check: async () => {
      const s = await sessionKind();
      if (s.kind !== 'operator') return `expected operator, got ${s.kind}`;
      if (s.leadId !== lead1?.id) return `expected lead ${lead1?.id}, got ${s.leadId}`;
      return null;
    }
  });

  await step('callback agent:main → session=main', callbackQuery(ctx, 'agent:main'), {
    gap: 1_500,
    check: async () => {
      const s = await sessionKind();
      return s.kind === 'main' ? null : `expected main, got ${s.kind}`;
    }
  });

  await step(`callback agent:lead:${lead2?.id} → session=operator`, callbackQuery(ctx, `agent:lead:${lead2?.id}`), {
    gap: 1_500,
    check: async () => {
      const s = await sessionKind();
      if (s.kind !== 'operator') return `expected operator, got ${s.kind}`;
      if (s.leadId !== lead2?.id) return `expected lead ${lead2?.id}, got ${s.leadId}`;
      return null;
    }
  });

  // ═══ SECTION 3: agent LLM turns (one per type) ═════════════════════════════
  if (RUN_LLM) {
    console.log('\n══════ SECTION 3: Agent LLM turns ══════');

    // main_assistant
    const mainConv = await q<{ id: string }>(
      `SELECT id FROM conversations WHERE type='main_assistant' AND admin_id=$1 LIMIT 1`,
      [primaryAdmin?.id]
    );
    const mainConvId = mainConv[0]?.id;
    const mainBefore = mainConvId
      ? (await q<{ n: string }>(`SELECT count(*)::text n FROM messages WHERE conversation_id=$1`, [mainConvId]))[0].n
      : '0';

    await step('/agent main (before LLM turn)', groupMessage(ctx, '/agent main'), { gap: 1_500 });
    await step('main_assistant LLM turn', groupMessage(ctx, 'Liste les leads les plus chauds, résume en 1 ligne'), {
      gap: 14_000,
      check: async () => {
        if (!mainConvId) return 'no main conv';
        const after = (await q<{ n: string }>(`SELECT count(*)::text n FROM messages WHERE conversation_id=$1`, [mainConvId]))[0].n;
        return Number(after) > Number(mainBefore) ? null : `no new messages (before=${mainBefore} after=${after})`;
      }
    });

    // operator
    await step(`/agent lead ${lead2?.anon_seq} (operator)`, groupMessage(ctx, `/agent lead ${lead2?.anon_seq}`), { gap: 1_500 });
    const opConv = await q<{ id: string }>(
      `SELECT id FROM conversations WHERE type='operator' AND lead_id=$1 LIMIT 1`,
      [lead2?.id]
    );
    const opConvId = opConv[0]?.id;
    const opBefore = opConvId
      ? (await q<{ n: string }>(`SELECT count(*)::text n FROM messages WHERE conversation_id=$1`, [opConvId]))[0].n
      : '0';
    await step('operator LLM turn', groupMessage(ctx, 'Résume la situation de ce client en 1 phrase'), {
      gap: 14_000,
      check: async () => {
        if (!opConvId) return 'no operator conv (will be created lazily — recheck)';
        const after = (await q<{ n: string }>(`SELECT count(*)::text n FROM messages WHERE conversation_id=$1`, [opConvId]))[0].n;
        return Number(after) > Number(opBefore) ? null : `no new messages (before=${opBefore} after=${after})`;
      }
    });

    // lead-facing (web chat, not Telegram)
    console.log('\n▶ lead-facing /api/chat turn');
    try {
      const res = await fetch(`${BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Le studio à Montmartre est-il toujours disponible ?', listingId: 'montmartre-studio' })
      });
      const body = (await res.json().catch(() => null)) as { reply?: string; messages?: unknown[] } | null;
      const ok = res.status === 200 && !!body && (!!body.reply || (Array.isArray(body.messages) && body.messages.length > 0));
      record('lead-facing LLM turn', ok, ok ? `HTTP 200, reply len=${body?.reply?.length ?? 0}` : `HTTP ${res.status}`);
    } catch (e) {
      record('lead-facing LLM turn', false, `threw: ${(e as Error).message}`);
    }
  } else {
    console.log('\n(skipping SECTION 3 — LLM disabled via --no-llm)');
  }

  // ═══ SECTION 4: /reset (destructive — last) ════════════════════════════════
  console.log('\n══════ SECTION 4: /reset (destructive) ══════');
  await step('/agent main (before reset)', groupMessage(ctx, '/agent main'), { gap: 1_500 });

  const mainConv2 = await q<{ id: string }>(
    `SELECT id FROM conversations WHERE type='main_assistant' AND admin_id=$1 LIMIT 1`,
    [primaryAdmin?.id]
  );
  const resetConvId = mainConv2[0]?.id;
  const beforeReset = resetConvId
    ? (await q<{ n: string }>(`SELECT count(*)::text n FROM messages WHERE conversation_id=$1`, [resetConvId]))[0].n
    : '0';

  await step('/reset → clears active agent history', groupMessage(ctx, '/reset'), {
    gap: 3_000,
    check: async () => {
      if (!resetConvId) return 'no main conv to reset';
      const after = (await q<{ n: string }>(`SELECT count(*)::text n FROM messages WHERE conversation_id=$1`, [resetConvId]))[0].n;
      const [summ] = await q<{ thread_summary: string | null }>(
        `SELECT thread_summary FROM conversations WHERE id=$1`, [resetConvId]
      );
      if (Number(after) !== 0) return `expected 0 messages after reset, got ${after} (before=${beforeReset})`;
      if (summ?.thread_summary !== null) return `thread_summary not cleared`;
      return null;
    }
  });

  // ─── Report ────────────────────────────────────────────────────────────────
  const failed = rec.report();
  await closeDb();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error('DRIVER ERROR:', e);
  await closeDb();
  process.exit(1);
});
