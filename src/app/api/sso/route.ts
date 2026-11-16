import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/core/password';
import { createSession } from '@/core/session';
import { Role } from '@/core/enums';
import { audit, AuditAction } from '@/lib/audit';
import { parseSteps, landingHref } from '@/lib/access';
import { ROLE_SERVICE_COOKIE, resolveSsoAdmin, safeNext, ssoEnabled, verifyRoleServiceToken, type SsoDb } from '@/lib/role-service';

export const runtime = 'nodejs';
// Har so'rovda bajariladi: aks holda Next build paytida (ROLE_SERVICE_JWT_SECRET yo'q) natijani qotirib qo'yadi.
export const dynamic = 'force-dynamic';

// SSO kirish: role-service'ning `mko_session` cookie'sini tekshiradi, mos Admin qatorini topadi/yaratadi va
// odatdagi docsystem_session cookie'sini beradi. Muvaffaqiyatsiz bo'lsa /login?sso=failed (qaytib /api/sso ga emas).
// Relativ Location — proksi ortidagi ichki host bilan chalkashmaslik uchun (logout route'dagi kabi).
const go = (path: string) => new NextResponse(null, { status: 303, headers: { Location: path } });

export async function GET(req: NextRequest) {
  if (!ssoEnabled()) return go('/login');
  const fail = () => go('/login?sso=failed');

  const claims = await verifyRoleServiceToken(req.cookies.get(ROLE_SERVICE_COOKIE)?.value);
  if (!claims) return fail();

  const unusable = await hashPassword(randomBytes(32).toString('hex'));
  const r = await resolveSsoAdmin(prisma as unknown as SsoDb, claims, unusable);
  if (!r.ok) return fail();

  const admin = r.admin;
  const role = admin.role === 'YURIST' ? Role.YURIST : Role.ADMIN;
  const token = await createSession({ sub: String(admin.id), login: admin.username, role, fullName: admin.fullName || admin.username });
  await audit(AuditAction.LOGIN, {
    actor: { id: admin.id, username: admin.username, role },
    target: `user:${admin.username}`,
    detail: { via: 'role-service', created: r.created },
  });

  const landing = landingHref({ role: role === Role.YURIST ? 'YURIST' : 'ADMIN', steps: parseSteps(admin.steps) });
  const res = go(safeNext(req.nextUrl.searchParams.get('next')) ?? landing ?? '/');
  // Login route bilan bir xil cookie parametrlari.
  res.cookies.set('docsystem_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24,
    domain: process.env.COOKIE_DOMAIN || undefined,
    secure: process.env.COOKIE_SECURE === '1',
  });
  return res;
}
