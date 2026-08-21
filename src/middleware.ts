import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  const token = req.cookies.get('docsystem_session')?.value;
  const isLogin = req.nextUrl.pathname.startsWith('/login');
  const isAuthApi = req.nextUrl.pathname.startsWith('/api/auth');
  // Healthcheck must stay public — otherwise the container probe follows the login redirect (a 200
  // page) and reports "healthy" WITHOUT ever hitting the DB, masking a real MySQL outage.
  const isHealth = req.nextUrl.pathname === '/api/health';
  // The MIB SMS webhook must stay public — the operator's phone/SMS-forwarder posts the OTP here and
  // cannot send an auth cookie. It only ever WRITES a numeric code; no data is read out through it.
  const isMibWebhook = req.nextUrl.pathname.startsWith('/api/mib-webhook');
  if (!token && !isLogin && !isAuthApi && !isHealth && !isMibWebhook) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
