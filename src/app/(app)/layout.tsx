import { cookies } from 'next/headers';
import { requireAdmin } from '@/lib/auth';
import { konveyerSnapshots, konveyerStageBadges } from '@/lib/konveyer';
import { AppShell } from '@/ui';
import type { NavItem } from '@/ui/AppShell';
import { SnapshotPicker } from './konveyer/SnapshotPicker';

export const dynamic = 'force-dynamic';

const NAV: NavItem[] = [
  // Boshqaruv — the konveyer pipeline, one page per stage (functions moved out of the old Hisobot page).
  { href: '/konveyer', label: 'Hisobot', icon: 'dashboard', section: 'Boshqaruv' },
  { href: '/talabnoma', label: 'Talabnoma', icon: 'files', section: 'Boshqaruv', step: 1 },
  { href: '/ariza', label: 'Ariza · palata', icon: 'pen', section: 'Boshqaruv', step: 2 },
  { href: '/invoice', label: 'Invoice · buxgalteriya', icon: 'file-plus', section: 'Boshqaruv', step: 3 },
  { href: '/sud', label: 'Sud (adolat)', icon: 'building', section: 'Boshqaruv', step: 4 },
  { href: '/mib', label: 'MIB · ijro', icon: 'check', section: 'Boshqaruv', step: 5 },
  // Menyu
  { href: '/hujjatlar', label: 'Hujjatlar', icon: 'files', section: 'Menyu' },
  { href: '/mijozlar', label: 'Mijozlar', icon: 'users', section: 'Menyu' },
  // { href: '/invoyslar', label: 'Invoice yaratish', icon: 'file-plus' }, // vaqtincha yashirildi
  { href: '/firms', label: 'Firmalar', icon: 'building', section: 'Menyu' },
  // Pinned to the bottom (above the user footer).
  { href: '/ulanishlar', label: 'Ulanishlar', icon: 'link', bottom: true },
  { href: '/settings', label: 'Sozlamalar', icon: 'archive', bottom: true },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdmin();

  // Shared pipeline date: rendered once in the sidebar (Boshqaruv), driven by the konv_s cookie —
  // every step-page and Hisobot read the same cookie, so one pick moves the whole pipeline.
  // Guarded: a DB hiccup here must not 500 EVERY app page — the sidebar just renders without the picker.
  const snaps = await konveyerSnapshots().catch(() => [] as Awaited<ReturnType<typeof konveyerSnapshots>>);
  const cookieS = cookies().get('konv_s')?.value;
  const parsed = cookieS ? Number(cookieS) : NaN;
  const selectedSnap = Number.isInteger(parsed) && parsed > 0 && snaps.some((s) => s.id === parsed) ? parsed : (snaps[0]?.id ?? 0);

  // Per-stage case counts → stepper badges (scoped to the selected snapshot). Guarded like the picker.
  const b = await konveyerStageBadges(selectedSnap).catch(() => ({ phase: {} as Record<string, number>, talabnoma: 0, total: 0 }));
  const badgeByHref: Record<string, string> = {
    '/talabnoma': b.total > 0 ? `${b.talabnoma}/${b.total}` : '',
    '/ariza': String(b.phase.SIGN ?? 0),
    '/invoice': String(b.phase.BOJ ?? 0),
    '/sud': String(b.phase.COURT ?? 0),
    '/mib': String(b.phase.EXEC ?? 0),
  };
  const nav = NAV.map((i) => (badgeByHref[i.href] ? { ...i, badgeText: badgeByHref[i.href] } : i));

  return (
    <AppShell
      appName="Docsystem"
      nav={nav}
      user={{ fullName: session.username, roleLabel: 'Admin' }}
      stepperExtra={snaps.length ? <SnapshotPicker options={snaps} value={selectedSnap} /> : undefined}
    >
      {children}
    </AppShell>
  );
}
