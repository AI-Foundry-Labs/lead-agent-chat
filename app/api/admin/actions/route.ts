import {
  getConversation,
  updateConversation,
  addMessage
} from '@/lib/db';
import { requireAdmin, toAuthResponse } from '@/lib/auth';
import { dispatchReply, mirrorLeadTurnToTopic } from '@/lib/dispatch';
import { broadcastConversationUpdate } from '@/lib/events';
import { notifyAgency } from '@/lib/telegram/notify-agency';
import { listingSchema, listingUpdateSchema, criterionSchema } from '@/lib/types';
import {
  createListing,
  getListing,
  updateListing,
  deleteListing,
  updateCriteria,
  createHandoffRule,
  getHandoffRule,
  toggleHandoffRule,
  deleteHandoffRule
} from '@/lib/db';
import { z } from 'zod';

export const runtime = 'nodejs';

async function resolveVisitorThread(conversationId: string, agencyId: string) {
  const conv = await getConversation(conversationId);
  if (!conv || conv.type !== 'lead' || conv.agency_id !== agencyId) return null;
  return conv;
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const agencyId = admin.agency_id;
    const body = await req.json().catch(() => null);
    const kind = body?.kind as string | undefined;

    switch (kind) {
      case 'takeover': {
        const conv = body.conversation_id
          ? await resolveVisitorThread(String(body.conversation_id), agencyId)
          : null;
        if (!conv) return notFound();
        if (conv.mode !== 'manual') {
          await updateConversation(conv.id, { mode: 'manual' });
          // Notify agency group that a web admin has taken over.
          const adminName = admin.name ?? admin.email ?? 'Admin';
          const notice =
            `🧑‍💼 Prise en charge par ${adminName} (web). Le bot est mis en pause.\n` +
            `🧑‍💼 Taken over by ${adminName} (web). The bot is now paused.`;
          if (conv.lead_id) void notifyAgency(conv.agency_id, conv.lead_id, notice);
        }
        broadcastConversationUpdate(conv.id);
        return ok();
      }
      case 'release': {
        const conv = body.conversation_id
          ? await resolveVisitorThread(String(body.conversation_id), agencyId)
          : null;
        if (!conv) return notFound();
        if (conv.mode !== 'agent') {
          await updateConversation(conv.id, { mode: 'agent' });
          // Notify agency group that the agent has been resumed via web.
          const adminName = admin.name ?? admin.email ?? 'Admin';
          const notice =
            `🤖 Agent réactivé par ${adminName} (web). Le bot reprend les réponses automatiques.\n` +
            `🤖 Agent resumed by ${adminName} (web). The bot is now handling replies again.`;
          if (conv.lead_id) void notifyAgency(conv.agency_id, conv.lead_id, notice);
        }
        broadcastConversationUpdate(conv.id);
        return ok();
      }
      case 'send_reply': {
        const content = z.string().min(1).parse(body.content);
        const conv = body.conversation_id
          ? await resolveVisitorThread(String(body.conversation_id), agencyId)
          : null;
        if (!conv) return notFound();
        await addMessage({ conversation_id: conv.id, role: 'admin', content });
        await dispatchReply(conv, content);
        // Mirror web admin reply into Topic 1 so Telegram stays in sync.
        void mirrorLeadTurnToTopic(conv, 'admin', content).catch((e) =>
          console.error('[actions] mirrorLeadTurnToTopic failed — non-fatal:', e)
        );
        broadcastConversationUpdate(conv.id);
        return ok();
      }
      case 'create_listing': {
        const l = listingSchema.omit({ agency_id: true }).parse(body.listing);
        await createListing({ ...l, agency_id: agencyId, image_url: l.image_url ?? null });
        return ok();
      }
      case 'update_listing': {
        const listingId = String(body.id);
        const existing = await getListing(listingId);
        if (!existing || existing.agency_id !== agencyId) return notFound();
        await updateListing(listingId, listingUpdateSchema.parse(body.patch));
        return ok();
      }
      case 'delete_listing': {
        const listingId = String(body.id);
        const existing = await getListing(listingId);
        if (!existing || existing.agency_id !== agencyId) return notFound();
        await deleteListing(listingId);
        return ok();
      }
      case 'update_criteria': {
        await updateCriteria(agencyId, z.array(criterionSchema).min(1).parse(body.criteria));
        return ok();
      }
      case 'create_rule': {
        await createHandoffRule({
          agency_id: agencyId,
          description: z.string().min(1).parse(body.description),
          trigger_keywords: z.array(z.string()).parse(body.trigger_keywords ?? [])
        });
        return ok();
      }
      case 'toggle_rule': {
        const ruleId = String(body.id);
        const rule = await getHandoffRule(ruleId);
        if (!rule || rule.agency_id !== agencyId) return notFound();
        await toggleHandoffRule(ruleId, Boolean(body.active));
        return ok();
      }
      case 'delete_rule': {
        const ruleId = String(body.id);
        const rule = await getHandoffRule(ruleId);
        if (!rule || rule.agency_id !== agencyId) return notFound();
        await deleteHandoffRule(ruleId);
        return ok();
      }
      default:
        return Response.json({ error: 'unknown_kind' }, { status: 400 });
    }
  } catch (e) {
    const authRes = toAuthResponse(e);
    if (authRes) return authRes;
    console.error('[admin/actions] failed:', e);
    return Response.json({ error: 'action_failed' }, { status: 400 });
  }
}

const ok = () => Response.json({ ok: true });
const notFound = () => Response.json({ error: 'not_found' }, { status: 404 });
