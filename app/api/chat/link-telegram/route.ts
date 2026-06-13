import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getLeadIdFromCookies, issueLeadTelegramLinkToken } from '@/lib/auth';
import {
  assertLeadChatAccess,
  toConversationAccessResponse
} from '@/lib/conversation-access';
import { getDefaultAgency } from '@/lib/db/agencies';
import { buildLeadTelegramLinkInfo } from '@/lib/telegram/build-lead-telegram-link';
import { telegramConfigured } from '@/lib/telegram';

export const runtime = 'nodejs';

const bodySchema = z.object({
  conversationId: z.string().uuid()
});

/** Issue a single-use token so the visitor can open Telegram and /start to link. */
export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'invalid_input' }, { status: 400 });
  }

  if (!telegramConfigured()) {
    return Response.json({ error: 'telegram_not_configured' }, { status: 503 });
  }

  const leadId = await getLeadIdFromCookies();
  const agencyId =
    req.headers.get('x-agency-id') ??
    (await getDefaultAgency())?.id;
  if (!agencyId) {
    return Response.json({ error: 'agency_not_configured' }, { status: 503 });
  }
  let conv;
  try {
    conv = await assertLeadChatAccess(parsed.data.conversationId, leadId, agencyId);
  } catch (e) {
    return toConversationAccessResponse(e) ?? Response.json({ error: 'error' }, { status: 500 });
  }

  if (conv.primary_channel === 'telegram') {
    return Response.json({ error: 'already_on_telegram' }, { status: 400 });
  }

  const token = await issueLeadTelegramLinkToken({
    conversationId: conv.id,
    leadId: conv.lead_id,
    listingId: conv.listing_id
  });
  const link = await buildLeadTelegramLinkInfo(token);

  return Response.json({
    token: link.token,
    command: link.command,
    deep_link: link.deepLink,
    configured: link.configured,
    expires_in_hours: 24
  });
}
