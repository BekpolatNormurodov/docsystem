import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyPassword } from '@/core/password';
import { createSession } from '@/core/session';
import { Role } from '@/core/enums';
import { audit, AuditAction } from '@/lib/audit';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  // Validate the body — invalid JSON or missing fields must be a clean 400, not a
  // 500 (req.json() throws on non-JSON; findUnique({ username: undefined }) throws).
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Notoʻgʻri soʻrov' }, { status: 400 }); }
  const b = body as { username?: unknown; password?: unknown };
  const username = typeof b?.username === 'string' ? b.username.trim() : '';
  const password = typeof b?.password === 'string' ? b.password : '';
  if (!username || !password) return NextResponse.json({ error: 'Login va parol kerak' }, { status: 400 });

  const admin = await prisma.admin.findUnique({ where: { username } });
  if (!admin || !(await verifyPassword(password, admin.passwordHash))) {
    return NextResponse.json({ error: 'Login yoki parol xato' }, { status: 401 });
  }
  if (!admin.active) {
    return NextResponse.json({ error: 'Hisob faol emas — administratorga murojaat qiling' }, { status: 403 });
  }
  const role = admin.role === 'YURIST' ? Role.YURIST : Role.ADMIN;
  const token = await createSession({
    sub: String(admin.id),
    login: admin.username,
    role,
    fullName: admin.fullName || admin.username,
  });
  // Cookie isn't set on this response yet, so pass the actor explicitly.
  await audit(AuditAction.LOGIN, { actor: { id: admin.id, username: admin.username, role }, target: `user:${admin.username}` });
  const res = NextResponse.json({ ok: true });
  res.cookies.set('docsystem_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24, // 1 kun — JWT muddati bilan bir xil (src/core/session.ts)
    // COOKIE_DOMAIN=.yuristsystem.uz shares one session across yuristsystem.uz / dashboard. / api.
    // (the cookie is host-only otherwise, so each subdomain would need its own login). Unset => host-only.
    domain: process.env.COOKIE_DOMAIN || undefined,
    // Behind TLS-terminating Nginx the browser<->edge hop is HTTPS, so mark the cookie Secure in prod.
    // Gated by env so first-run bring-up over plain HTTP (before certs) still works. Set COOKIE_SECURE=1.
    secure: process.env.COOKIE_SECURE === '1',
  });
  return res;
}
