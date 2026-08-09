import { requireAdmin } from '@/lib/auth';
import { AppShell } from '@/ui';
import type { NavItem } from '@/ui/AppShell';

export const dynamic = 'force-dynamic';

const NAV: NavItem[] = [
  { href: '/konveyer', label: 'Hisobot', icon: 'dashboard' },
  { href: '/hujjatlar', label: 'Hujjatlar', icon: 'files' },
  { href: '/import', label: 'Import', icon: 'file-plus' },
  { href: '/mijozlar', label: 'Mijozlar', icon: 'users' },
  { href: '/invoyslar', label: 'Invoice yaratish', icon: 'file-plus' },
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
