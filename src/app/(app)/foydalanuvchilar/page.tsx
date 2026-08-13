import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { PageHeader } from '@/ui';
import { parseSteps } from '@/lib/access';
import { UsersManager } from './UsersManager';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const me = await requireAdmin();
  const [rows, logins] = await Promise.all([
    prisma.admin.findMany({
      orderBy: [{ active: 'desc' }, { role: 'asc' }, { username: 'asc' }],
      select: { id: true, username: true, role: true, fullName: true, steps: true, active: true, createdAt: true },
    }),
    // Last login per user, derived from the audit trail (no extra column needed).
    prisma.auditLog.groupBy({ by: ['username'], where: { action: 'LOGIN' }, _max: { createdAt: true } }),
  ]);
  const lastLogin = new Map(logins.map((l) => [l.username, l._max.createdAt]));
  const users = rows.map((r) => ({
    id: r.id,
    username: r.username,
    role: r.role === 'YURIST' ? ('YURIST' as const) : ('ADMIN' as const),
    fullName: r.fullName ?? '',
    steps: parseSteps(r.steps),
    active: r.active,
    createdAt: r.createdAt.toISOString(),
    lastLoginAt: lastLogin.get(r.username)?.toISOString() ?? null,
  }));
  return (
    <div>
      <PageHeader title="Foydalanuvchilar" subtitle="Adminlar va yuristlar — bosqich ruxsatlarini shu yerdan boshqaring" />
      <UsersManager users={users} meId={me.id} />
    </div>
  );
}
