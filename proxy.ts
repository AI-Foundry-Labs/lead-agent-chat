import { NextResponse, type NextRequest } from 'next/server';

const ADMIN_COOKIE = 'admin_session';

// Protect the admin surfaces. The assistant chat + lead views live under /admin.
export default function proxy(req: NextRequest) {
  const hasAdmin = !!req.cookies.get(ADMIN_COOKIE);
  if (!hasAdmin) {
    const url = req.nextUrl.clone();
    url.pathname = '/admin/login';
    url.searchParams.set('next', req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // The /admin dashboard itself, plus everything under it except the login page.
  matcher: ['/admin', '/admin/((?!login).*)']
};
