import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { hashPassword } from '@/core/password';
import { parseSteps } from '@/lib/access';
import { audit, AuditAction } from '@/lib/audit';

export const runtime = 'nodejs';

// Create a user. Admins are full-access (steps ignored); yuristlar get exactly the
// granted step keys. Password is hashed here — never stored or logged in the clear.
export async function POST(req: NextRequest) {
  await requireAdmin();
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Notoʻgʻri soʻrov' }, { status: 400 }); }
  const b = (body ?? {}) as Record<string, unknown>;

  const username = typeof b.username === 'string' ? b.username.trim() : '';
  const password = typeof b.password === 'string' ? b.password : '';
  const fullName = typeof b.fullName === 'string' ? b.fullName.trim() : '';
  const role = b.role === 'ADMIN' ? 'ADMIN' : 'YURIST';
  const steps = role === 'YURIST' ? parseSteps(b.steps) : [];

  if (username.length < 3) return NextResponse.json({ error: 'Login kamida 3 belgidan iborat boʻlsin' }, { status: 400 });
  if (password.length < 4) return NextResponse.json({ error: 'Parol kamida 4 belgidan iborat boʻlsin' }, { status: 400 });
  if (role === 'YURIST' && steps.length === 0) return NextResponse.json({ error: 'Yuristga kamida bitta bosqich bering' }, { status: 400 });

  const exists = await prisma.admin.findUnique({ where: { username }, select: { id: true } });
  if (exists) return NextResponse.json({ error: 'Bunday login allaqachon mavjud' }, { status: 409 });

  const user = await prisma.admin.create({
    data: { username, passwordHash: await hashPassword(password), role, fullName: fullName || null, steps, active: true },
    select: { id: true, username: true, role: true, fullName: true, steps: true, active: true },
  });
  await audit(AuditAction.USER_CREATE, { target: `user:${username}`, detail: { role, steps } });
  return NextResponse.json(user, { status: 201 });
}
