import { NextResponse } from 'next/server';
import { audit, AuditAction } from '@/lib/audit';

export const runtime = 'nodejs';

export async function POST() {
  // Resolve the actor from the still-present cookie before we clear it.
  await audit(AuditAction.LOGOUT);
  const res = NextResponse.json({ ok: true });
  // Must clear with the SAME domain scope it was set with (see login route), or the browser keeps the
  // domain-wide cookie and the user stays logged in across subdomains after "chiqish".
  res.cookies.set('docsystem_session', '', {
    path: '/',
    maxAge: 0,
    domain: process.env.COOKIE_DOMAIN || undefined,
  });
  return res;
}
