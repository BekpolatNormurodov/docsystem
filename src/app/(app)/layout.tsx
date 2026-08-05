import { requireAdmin } from '@/lib/auth';
import { AppShell } from '@/ui';
import type { NavItem } from '@/ui/AppShell';

export const dynamic = 'force-dynamic';

const NAV: NavItem[] = [
  { href: '/', label: 'Kalendar', icon: 'calendar' },
  { href: '/import', label: 'Import', icon: 'file-plus' },
  { href: '/mijozlar', label: 'Mijozlar', icon: 'users' },
  { href: '/hujjatlar', label: 'Hujjatlar', icon: 'files' },
  { href: '/firms', label: 'Firmalar', icon: 'building' },
  { href: '/settings', label: 'Sozlamalar', icon: 'archive' },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdmin();

  return (
    <AppShell appName="Docsystem" nav={NAV} user={{ fullName: session.username, roleLabel: 'Admin' }}>
      {children}
    </AppShell>
  );
}
