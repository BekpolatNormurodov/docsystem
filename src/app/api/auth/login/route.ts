import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyPassword } from '@/core/password';
import { createSession } from '@/core/session';
import { Role } from '@/core/enums';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();
  const admin = await prisma.admin.findUnique({ where: { username } });
  if (!admin || !(await verifyPassword(password, admin.passwordHash))) {
    return NextResponse.json({ error: 'Login yoki parol xato' }, { status: 401 });
  }
  const token = await createSession({
    sub: String(admin.id),
    login: admin.username,
    role: Role.ADMIN,
    fullName: admin.username,
  });
  const res = NextResponse.json({ ok: true });
  res.cookies.set('docsystem_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
