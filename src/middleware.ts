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
  // SSO (role-service): /api/sso o'zi ochiq. Funksiya yoqilgan (JWT_SECRET) va brauzerda role-service'ning
  // `mko_session` cookie'si bor, lekin docsystem_session yo'q bo'lsa — /login emas, /api/sso (u tekshiradi va sessiya beradi).
  // Cookie bu yerda faqat BOR-YO'QLIGI bo'yicha tekshiriladi, imzo /api/sso'da. Muvaffaqiyatsiz bo'lsa /login?sso=failed
  // (isLogin ochiq) — qayta /api/sso ga qaytmaydi, sikl yo'q.
  const isSso = req.nextUrl.pathname === '/api/sso';
  if (!token && !isLogin && !isAuthApi && !isHealth && !isMibWebhook && !isSso) {
    if ((process.env.ROLE_SERVICE_JWT_SECRET?.trim() || process.env.JWT_SECRET?.trim()) && req.cookies.get('mko_session')?.value) {
      const url = new URL('/api/sso', req.url);
      url.searchParams.set('next', req.nextUrl.pathname + req.nextUrl.search);
      return NextResponse.redirect(url);
    }
    return NextResponse.redirect(new URL('/login', req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
