import { NextResponse, type NextRequest } from 'next/server';
import { resolveAgencyForVisit } from '@/lib/agency-context';

const ADMIN_COOKIE = 'admin_session';

/**
 * Next.js proxy (formerly "middleware"). Two responsibilities:
 *  1. Multi-tenant: resolve the agency from the request Host header and
 *     propagate it downstream via the server-set `x-agency-id` header.
 *     Any client-supplied `x-agency-id` is stripped first — it must never be
 *     trusted (tenant-isolation boundary). Routes fall back to the default
 *     agency when resolution yields nothing.
 *  2. Auth: protect the /admin surfaces, redirecting anonymous users to login.
 *
 * Proxy always runs on the Node.js runtime, so the postgres-js DB client used
 * by resolveAgencyForVisit works (no runtime export needed/allowed here).
 */
export const config = {
  // Run on every route except static assets / Next internals, so agency
  // resolution covers all entry points (admin protection is applied inside).
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
};

export default async function proxy(req: NextRequest): Promise<NextResponse> {
  const { pathname, searchParams } = req.nextUrl;

  // ── Admin protection: /admin and below, except the login page ──
  if (
    pathname === '/admin' ||
    (pathname.startsWith('/admin/') && !pathname.startsWith('/admin/login'))
  ) {
    if (!req.cookies.get(ADMIN_COOKIE)) {
      const url = req.nextUrl.clone();
      url.pathname = '/admin/login';
      url.searchParams.set('next', pathname);
      return NextResponse.redirect(url);
    }
  }

  // ── Agency resolution (server-side, host-first) ──
  const host = req.headers.get('host') ?? '';
  const listingId = searchParams.get('listingId') ?? undefined;

  let agencyId: string | null = null;
  try {
    const agency = await resolveAgencyForVisit({ host, listingId });
    agencyId = agency?.id ?? null;
  } catch (err) {
    // Resolution failure must not break the request — log and continue;
    // downstream routes fall back to the default agency.
    console.error('[proxy] agency resolution failed:', err);
  }

  const headers = new Headers(req.headers);
  headers.delete('x-agency-id'); // strip any client-supplied value
  if (agencyId) headers.set('x-agency-id', agencyId);
  headers.set('x-pathname', pathname);

  return NextResponse.next({ request: { headers } });
}
