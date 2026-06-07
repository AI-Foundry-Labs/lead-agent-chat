import { getLeadIdFromCookies } from '@/lib/auth';
import {
  getLastVisibleMessage,
  getListingById,
  listConversationsByLeadId
} from '@/lib/db';
import { getLang } from '@/lib/i18n-server';

export const runtime = 'nodejs';

export async function GET() {
  const leadId = await getLeadIdFromCookies();
  if (!leadId) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const lang = await getLang();
  const conversations = await listConversationsByLeadId(leadId);

  const threads = await Promise.all(
    conversations.map(async (conv) => {
      const [listing, lastMessage] = await Promise.all([
        conv.listing_id ? getListingById(conv.listing_id) : null,
        getLastVisibleMessage(conv.id)
      ]);
      const title =
        listing == null
          ? null
          : lang === 'en'
            ? listing.title_en
            : listing.title;
      const preview = lastMessage?.content?.slice(0, 160) ?? null;
      return {
        id: conv.id,
        listing_id: conv.listing_id,
        listing_title: title,
        mode: conv.mode,
        preview,
        updated_at: conv.updated_at.toISOString()
      };
    })
  );

  return Response.json({ threads });
}
