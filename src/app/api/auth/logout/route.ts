import { NextResponse } from 'next/server';
import { audit, AuditAction } from '@/lib/audit';

export const runtime = 'nodejs';

export async function POST() {
  // Resolve the actor from the still-present cookie before we clear it.
  await audit(AuditAction.LOGOUT);
  // Chiqish forma (POST) bilan yuboriladi (AppShell), shuning uchun JSON emas — REDIRECT qaytaramiz,
  // aks holda brauzer «{ok:true}» matnini sahifa qilib ko'rsatadi. 303 → target GET bo'lib ochiladi.
  // Location NISBIY ('/login') — proksi ortidagi ichki host bilan chalkashmaslik uchun.
  const res = new NextResponse(null, { status: 303, headers: { Location: '/login' } });
  // Must clear with the SAME domain scope it was set with (see login route), or the browser keeps the
  // domain-wide cookie and the user stays logged in across subdomains after "chiqish".
  res.cookies.set('docsystem_session', '', {
    path: '/',
    maxAge: 0,
    domain: process.env.COOKIE_DOMAIN || undefined,
  });
  return res;
}
