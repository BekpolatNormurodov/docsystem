import { NextResponse } from 'next/server';
import { BASE_PATH, withBase } from '@/lib/base-path';
import { audit, AuditAction } from '@/lib/audit';
import { ROLE_SERVICE_COOKIE, ROLE_SERVICE_REFRESH_COOKIE, ssoEnabled } from '@/lib/role-service';

export const runtime = 'nodejs';

export async function POST() {
  // Resolve the actor from the still-present cookie before we clear it.
  await audit(AuditAction.LOGOUT);
  // Chiqish forma (POST) bilan yuboriladi (AppShell), shuning uchun JSON emas — REDIRECT qaytaramiz,
  // aks holda brauzer «{ok:true}» matnini sahifa qilib ko'rsatadi. 303 → target GET bo'lib ochiladi.
  // Location NISBIY ('/login') — proksi ortidagi ichki host bilan chalkashmaslik uchun.
  const res = new NextResponse(null, { status: 303, headers: { Location: withBase('/login') } });
  // Must clear with the SAME domain scope it was set with (see login route), or the browser keeps the
  // domain-wide cookie and the user stays logged in across subdomains after "chiqish".
  res.cookies.set('docsystem_session', '', {
    path: BASE_PATH || '/',
    maxAge: 0,
    domain: process.env.COOKIE_DOMAIN || undefined,
  });
  // SSO yoqilgan bo'lsa umumiy cookie'larni ham tozalaymiz, aks holda /api/sso foydalanuvchini darrov qayta kiritadi.
  // role-service refresh cookie'si path=/api/auth ga qo'yiladi — shu path bilan o'chiriladi.
  if (ssoEnabled()) {
    const domain = process.env.ROLE_SERVICE_COOKIE_DOMAIN || undefined;
    res.cookies.set(ROLE_SERVICE_COOKIE, '', { path: '/', maxAge: 0, domain });
    res.cookies.set(ROLE_SERVICE_REFRESH_COOKIE, '', { path: withBase('/api/auth'), maxAge: 0, domain });
  }
  return res;
}
