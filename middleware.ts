import { type NextRequest, NextResponse } from 'next/server';
import { resolveAgencyForVisit } from '@/lib/agency-context';

/**
 * Next.js middleware: resolve agency from request Host header and propagate
 * it downstream via the x-agency-id request header.
 *
 * Downstream route handlers read the agency id via:
 *   request.headers.get('x-agency-id')
 *
 * NOTE: middleware runs in the Edge runtime so it cannot use the Node.js DB
 * client directly. Agency resolution calls the DB via the normal postgres
 * client — this works in the default Node.js middleware runtime (Next.js 15+
 * allows opting in via `export const runtime = 'nodejs'` on the middleware or
 * via next.config). For now we keep it simple and run in the default runtime.
 */

export const config = {
  // Match all routes except static files and Next internals.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
};

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const host = request.headers.get('host') ?? '';
  const { pathname, searchParams } = request.nextUrl;
  const listingId = searchParams.get('listingId') ?? undefined;

  let agencyId: string | null = null;
  try {
    const agency = await resolveAgencyForVisit({ host, listingId });
    agencyId = agency?.id ?? null;
  } catch (err) {
    // Resolution failure must not break the request — log and continue.
    console.error('[middleware] agency resolution failed:', err);
  }

  const headers = new Headers(request.headers);
  // Always strip any client-supplied x-agency-id — must come from server-side resolution only.
  headers.delete('x-agency-id');
  if (agencyId) {
    headers.set('x-agency-id', agencyId);
  }

  // Pass resolved pathname for route handlers that need it.
  headers.set('x-pathname', pathname);

  return NextResponse.next({ request: { headers } });
}
