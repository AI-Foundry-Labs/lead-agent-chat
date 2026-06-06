import {
  getConversationByLeadId,
  updateConversation,
  addMessage,
  createListing,
  updateListing,
  deleteListing,
  updateCriteria,
  createHandoffRule,
  toggleHandoffRule,
  deleteHandoffRule
} from '@/lib/db';
import { requireAdmin, toAuthResponse } from '@/lib/auth';
import { dispatchReply } from '@/lib/dispatch';
import { broadcastConversationUpdate } from '@/lib/events';
import { listingSchema, listingUpdateSchema, criterionSchema } from '@/lib/types';
import { z } from 'zod';

export const runtime = 'nodejs';

// Single dispatcher for every admin mutation (takeover, manual reply, config CRUD).
export async function POST(req: Request) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => null);
    const kind = body?.kind as string | undefined;

    switch (kind) {
      case 'takeover': {
        const conv = await getConversationByLeadId(String(body.lead_id));
        if (!conv) return notFound();
        await updateConversation(conv.id, { mode: 'manual' });
        broadcastConversationUpdate(conv.id);
        return ok();
      }
      case 'release': {
        const conv = await getConversationByLeadId(String(body.lead_id));
        if (!conv) return notFound();
        await updateConversation(conv.id, { mode: 'agent' });
        broadcastConversationUpdate(conv.id);
        return ok();
      }
      case 'send_reply': {
        const content = z.string().min(1).parse(body.content);
        const conv = await getConversationByLeadId(String(body.lead_id));
        if (!conv) return notFound();
        await addMessage({ conversation_id: conv.id, role: 'admin', content });
        await dispatchReply(conv, content);
        broadcastConversationUpdate(conv.id);
        return ok();
      }
      case 'create_listing': {
        const l = listingSchema.parse(body.listing);
        await createListing({ ...l, image_url: l.image_url ?? null });
        return ok();
      }
      case 'update_listing': {
        await updateListing(String(body.id), listingUpdateSchema.parse(body.patch));
        return ok();
      }
      case 'delete_listing': {
        await deleteListing(String(body.id));
        return ok();
      }
      case 'update_criteria': {
        await updateCriteria(z.array(criterionSchema).min(1).parse(body.criteria));
        return ok();
      }
      case 'create_rule': {
        await createHandoffRule({
          description: z.string().min(1).parse(body.description),
          trigger_keywords: z.array(z.string()).parse(body.trigger_keywords ?? [])
        });
        return ok();
      }
      case 'toggle_rule': {
        await toggleHandoffRule(String(body.id), Boolean(body.active));
        return ok();
      }
      case 'delete_rule': {
        await deleteHandoffRule(String(body.id));
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
