import { z } from 'zod';
import { getLeadIdFromCookies } from '@/lib/auth';
import { claimConversationsForLead } from '@/lib/db';

export const runtime = 'nodejs';

const schema = z.object({
  conversationIds: z.array(z.string().uuid()).max(50)
});

/** Attach anonymous listing chats to the logged-in lead (post-login claim). */
export async function POST(req: Request) {
  const leadId = await getLeadIdFromCookies();
  if (!leadId) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'invalid_input' }, { status: 400 });
  }

  const claimed = await claimConversationsForLead(
    leadId,
    parsed.data.conversationIds
  );
  return Response.json({ claimed });
}
