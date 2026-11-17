import { NextRequest, NextResponse } from 'next/server';
import { BASE_PATH } from '@/lib/base-path';
import { prisma } from '@/lib/db';
import { randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword } from '@/core/password';
import { createSession } from '@/core/session';
import { Role } from '@/core/enums';
import { audit, AuditAction } from '@/lib/audit';
import { getT } from '@/lib/i18n/server';
import { bridgeLogin, resolveSsoAdmin, verifyRoleServiceToken, type SsoDb } from '@/lib/role-service';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const t = getT();
  // Validate the body — invalid JSON or missing fields must be a clean 400, not a
  // 500 (req.json() throws on non-JSON; findUnique({ username: undefined }) throws).
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: t('Notoʻgʻri soʻrov') }, { status: 400 }); }
  const b = body as { username?: unknown; password?: unknown };
  const username = typeof b?.username === 'string' ? b.username.trim() : '';
  const password = typeof b?.password === 'string' ? b.password : '';
  if (!username || !password) return NextResponse.json({ error: t('Login va parol kerak') }, { status: 400 });

  type LoginAdmin = { id: number; username: string; role: string; fullName: string | null; active: boolean };
  const found = await prisma.admin.findUnique({ where: { username } });
  let admin: LoginAdmin | null = found;
  // role-service — markaziy login: mahalliy jadval qabul qilmagan login/parol (yo'q login, boshqa joyda o'zgargan parol)
  // avval role-service'dan so'raladi. Imzosi tekshirilgan token + yurist huquqi (grants.yurist) bo'lsa, mos admin topiladi/yaratiladi
  // va odatdagi sessiya ochiladi. role-service o'chiq/yetib bo'lmasa — oldingidek 401.
  let bridged: Awaited<ReturnType<typeof bridgeLogin>> = null;
  if (!found || !(await verifyPassword(password, found.passwordHash))) {
    bridged = await bridgeLogin(username, password);
    const claims = bridged ? await verifyRoleServiceToken(bridged.accessToken) : null;
    const sso = claims ? await resolveSsoAdmin(prisma as unknown as SsoDb, claims, await hashPassword(randomBytes(32).toString('hex'))) : null;
    if (!sso || !sso.ok) return NextResponse.json({ error: t('Login yoki parol xato') }, { status: 401 });
    admin = sso.admin;
  }
  if (!admin) return NextResponse.json({ error: t('Login yoki parol xato') }, { status: 401 });
  if (!admin.active) {
    return NextResponse.json({ error: t('Hisob faol emas — administratorga murojaat qiling') }, { status: 403 });
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
    // Scoped to the app's base path (/yurist) so the session is not sent to the sibling services on the domain.
    path: BASE_PATH || '/',
    maxAge: 60 * 60 * 24, // 1 kun — JWT muddati bilan bir xil (src/core/session.ts)
    // COOKIE_DOMAIN=.yuristsystem.uz shares one session across yuristsystem.uz / dashboard. / api.
    // (the cookie is host-only otherwise, so each subdomain would need its own login). Unset => host-only.
    domain: process.env.COOKIE_DOMAIN || undefined,
    // Behind TLS-terminating Nginx the browser<->edge hop is HTTPS, so mark the cookie Secure in prod.
    // Gated by env so first-run bring-up over plain HTTP (before certs) still works. Set COOKIE_SECURE=1.
    secure: process.env.COOKIE_SECURE === '1',
  });
  // role-service ko'prigi (best effort): shu login/parol role-service'da ham bo'lsa, umumiy `mko_session` cookie'si beriladi —
  // boshqa servislar (kadr) kirgan deb biladi. Xato kirishni HECH QACHON to'xtatmaydi (bridgeLogin throw qilmaydi).
  bridged ??= await bridgeLogin(admin.username, password);
  if (bridged) {
    res.cookies.set('mko_session', bridged.accessToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: bridged.expiresIn,
      domain: process.env.ROLE_SERVICE_COOKIE_DOMAIN || undefined,
      secure: process.env.COOKIE_SECURE === '1',
    });
  }
  return res;
}
