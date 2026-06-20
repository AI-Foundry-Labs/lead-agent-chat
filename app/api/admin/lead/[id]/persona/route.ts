export const runtime = 'nodejs';

// Lead persona has been removed — persona is now an admin-level field.
// This endpoint is deprecated; return 410 Gone.
export async function PATCH() {
  return Response.json({ error: 'gone' }, { status: 410 });
}
