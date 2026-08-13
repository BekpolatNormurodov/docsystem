import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { hashPassword } from '@/core/password';
import { parseSteps } from '@/lib/access';
import { audit, AuditAction } from '@/lib/audit';

export const runtime = 'nodejs';

// Would this change leave the system with no active admin? Guards demotion,
// deactivation, and deletion of the last admin so nobody can lock everyone out.
async function lastActiveAdmin(id: number): Promise<boolean> {
  const others = await prisma.admin.count({ where: { role: 'ADMIN', active: true, id: { not: id } } });
  return others === 0;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await requireAdmin();
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'id notoʻgʻri' }, { status: 400 });

  const target = await prisma.admin.findUnique({ where: { id }, select: { id: true, username: true, role: true, active: true } });
  if (!target) return NextResponse.json({ error: 'Foydalanuvchi topilmadi' }, { status: 404 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Notoʻgʻri soʻrov' }, { status: 400 }); }
  const b = (body ?? {}) as Record<string, unknown>;

  const data: Record<string, unknown> = {};
  if (typeof b.fullName === 'string') data.fullName = b.fullName.trim() || null;
  if (b.role === 'ADMIN' || b.role === 'YURIST') data.role = b.role;
  if (typeof b.active === 'boolean') data.active = b.active;
  // steps only apply to a yurist; when the final role is ADMIN we clear them.
  const finalRole = (data.role as string) ?? target.role;
  if (finalRole === 'ADMIN') data.steps = [];
  else if (Array.isArray(b.steps)) data.steps = parseSteps(b.steps);
  if (typeof b.password === 'string' && b.password.length > 0) {
    if (b.password.length < 4) return NextResponse.json({ error: 'Parol kamida 4 belgidan iborat boʻlsin' }, { status: 400 });
    data.passwordHash = await hashPassword(b.password);
  }

  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'Oʻzgartirish yoʻq' }, { status: 400 });

  // Lock-out guards: only relevant when the target is currently an active admin.
  if (target.role === 'ADMIN' && target.active) {
    const demoting = data.role === 'YURIST';
    const deactivating = data.active === false;
    if ((demoting || deactivating) && (await lastActiveAdmin(id))) {
      return NextResponse.json({ error: 'Bu oxirgi faol admin — rolini/holatini oʻzgartirib boʻlmaydi' }, { status: 409 });
    }
    if (target.id === me.id && (demoting || deactivating)) {
      return NextResponse.json({ error: 'Oʻzingizni admin huquqidan mahrum qila olmaysiz' }, { status: 409 });
    }
  }
  if (finalRole === 'YURIST' && Array.isArray(data.steps) && (data.steps as string[]).length === 0) {
    return NextResponse.json({ error: 'Yuristga kamida bitta bosqich bering' }, { status: 400 });
  }

  const user = await prisma.admin.update({
    where: { id },
    data,
    select: { id: true, username: true, role: true, fullName: true, steps: true, active: true },
  });
  await audit(AuditAction.USER_UPDATE, { target: `user:${target.username}`, detail: { fields: Object.keys(data), role: user.role, steps: user.steps, active: user.active } });
  return NextResponse.json(user);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const me = await requireAdmin();
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'id notoʻgʻri' }, { status: 400 });
  if (id === me.id) return NextResponse.json({ error: 'Oʻzingizni oʻchira olmaysiz' }, { status: 409 });

  const target = await prisma.admin.findUnique({ where: { id }, select: { id: true, username: true, role: true, active: true } });
  if (!target) return NextResponse.json({ error: 'Foydalanuvchi topilmadi' }, { status: 404 });
  if (target.role === 'ADMIN' && target.active && (await lastActiveAdmin(id))) {
    return NextResponse.json({ error: 'Bu oxirgi faol admin — oʻchirib boʻlmaydi' }, { status: 409 });
  }

  await prisma.admin.delete({ where: { id } });
  await audit(AuditAction.USER_DELETE, { target: `user:${target.username}`, detail: { role: target.role } });
  return NextResponse.json({ ok: true });
}
