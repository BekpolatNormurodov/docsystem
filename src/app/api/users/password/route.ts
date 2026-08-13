import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { verifyPassword, hashPassword } from '@/core/password';
import { audit, AuditAction } from '@/lib/audit';

export const runtime = 'nodejs';

// Self-service password change for the signed-in user (admin OR yurist). Requires
// the current password — an admin who wants to RESET someone else's password uses
// the Foydalanuvchilar editor instead (no current password needed there).
export async function POST(req: NextRequest) {
  const me = await requireUser();
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Notoʻgʻri soʻrov' }, { status: 400 }); }
  const b = (body ?? {}) as Record<string, unknown>;
  const current = typeof b.current === 'string' ? b.current : '';
  const next = typeof b.next === 'string' ? b.next : '';
  if (next.length < 4) return NextResponse.json({ error: 'Yangi parol kamida 4 belgidan iborat boʻlsin' }, { status: 400 });
  if (next === current) return NextResponse.json({ error: 'Yangi parol joriy paroldan farq qilsin' }, { status: 400 });

  const row = await prisma.admin.findUnique({ where: { id: me.id }, select: { passwordHash: true } });
  if (!row || !(await verifyPassword(current, row.passwordHash))) {
    return NextResponse.json({ error: 'Joriy parol xato' }, { status: 400 });
  }
  await prisma.admin.update({ where: { id: me.id }, data: { passwordHash: await hashPassword(next) } });
  await audit(AuditAction.PASSWORD_CHANGE, { target: `user:${me.username}` });
  return NextResponse.json({ ok: true });
}
