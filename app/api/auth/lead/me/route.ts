import { getLeadIdFromCookies } from '@/lib/auth';
import { getLeadById } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET() {
  const leadId = await getLeadIdFromCookies();
  if (!leadId) return Response.json({ authenticated: false });

  const lead = await getLeadById(leadId);
  if (!lead) return Response.json({ authenticated: false });

  return Response.json({
    authenticated: true,
    email: lead.email,
    name: lead.name
  });
}
