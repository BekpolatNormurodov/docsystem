'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Ico, NAV_ICONS } from './icons';
import { ThemeToggle } from './ThemeToggle';
import { Logo } from './Logo';

export interface NavItem {
  href: string;
  label: string;
  /** Key from NAV_ICONS (serializable across the RSC boundary). */
  icon: string;
  badge?: number;
  /** Uppercase section heading this item is grouped under. */
  section?: string;
}

/**
 * A second sidebar state, entered by route rather than by clicking.
 *
 * The one case this exists for: writing a new maʼlumotnoma, where picking the firm picks the blank
 * the whole page is made of. That is navigation, not a form field — so it belongs in the sidebar,
 * and deriving it from the URL means the browser's back button and a reload both behave.
 *
 * Described declaratively so this component stays ignorant of what an ariza is.
 */
export interface NavPanel {
  /** Path prefix that puts the sidebar in this state. */
  match: string;
  title: string;
  /** Where the back control returns to. */
  back: { href: string; label: string };
  items: NavItem[];
  emptyLabel?: string;
}

export interface AppShellProps {
  appName: string;
  nav: NavItem[];
  user: { fullName: string; roleLabel?: string };
  logoutAction?: string;
  panel?: NavPanel;
  children: React.ReactNode;
}

/** Sidebar-panel glyph — filled strip when expanded, hollow when collapsed (credit-core). */
function PanelToggle({ className, open }: { className?: string; open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <line x1="9" y1="4" x2="9" y2="20" />
      {open && <rect x="4.2" y="5.2" width="3.6" height="13.6" rx="1" fill="currentColor" stroke="none" opacity={0.25} />}
    </svg>
  );
}

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

export function AppShell({
  appName,
  nav,
  user,
  logoutAction = '/api/auth/logout',
  panel,
  children,
}: AppShellProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem('spravka.sidebar.collapsed') === '1');
  }, []);
  useEffect(() => {
    localStorage.setItem('spravka.sidebar.collapsed', collapsed ? '1' : '0');
  }, [collapsed]);
  useEffect(() => setOpen(false), [pathname]);

  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));
  const current = nav.find((n) => isActive(n.href));

  const sections: { label: string; items: NavItem[] }[] = [];
  for (const item of nav) {
    const label = item.section ?? 'Menyu';
    const g = sections.find((s) => s.label === label);
    if (g) g.items.push(item);
    else sections.push({ label, items: [item] });
  }

  // A panel takes the sidebar over for as long as the route is inside it. Collapsing still works —
  // it just falls back to the main-nav rail (readable icons) rather than a rail of identical firm
  // icons. So the firm panel is shown only while the sidebar is expanded.
  const inPanel = !!panel && pathname.startsWith(panel.match);
  const rail = collapsed;

  const renderItem = (item: NavItem) => {
    const active = isActive(item.href);
    const Icon = NAV_ICONS[item.icon] ?? Ico.files;
    return (
      <Link
        key={item.href}
        href={item.href}
        title={item.label}
        aria-current={active ? 'page' : undefined}
        className={cx(
          'group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
          rail && 'lg:justify-center lg:px-0',
          active ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
        )}
      >
        {active && <span aria-hidden className="absolute inset-y-1.5 left-0 w-1 rounded-r-full bg-brand-600 dark:bg-brand-400" />}
        <span className={cx('shrink-0', active && 'text-brand-600 dark:text-brand-400')}>
          <Icon />
        </span>
        <span className={cx('flex-1 truncate', rail && 'lg:hidden')}>{item.label}</span>
        {!!item.badge && item.badge > 0 && (
          <span className={cx('shrink-0 rounded-full bg-brand-600 px-1.5 text-[10px] font-semibold leading-5 text-white', rail && 'lg:hidden')}>
            {item.badge > 99 ? '99+' : item.badge}
          </span>
        )}
        {rail && !!item.badge && item.badge > 0 && (
          <span aria-hidden className="absolute right-2 top-2 hidden h-2 w-2 rounded-full bg-brand-500 lg:block" />
        )}
      </Link>
    );
  };

  return (
    <div className="min-h-screen">
      {open && (
        <div className="fixed inset-0 z-40 bg-slate-900/25 dark:bg-slate-950/40 lg:hidden" onClick={() => setOpen(false)} aria-hidden />
      )}

      <aside
        className={cx(
          'fixed inset-y-0 left-0 z-50 flex flex-col border-r border-line bg-surface px-5 py-6 transition-all duration-300 ease-in-out',
          open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
          rail ? 'w-[290px] lg:w-[88px] lg:px-3' : 'w-[290px]',
        )}
      >
        <div className={cx('mb-6 flex items-center gap-2.5', rail && 'lg:justify-center')}>
          <Logo size={36} className="shrink-0" />
          <div className={cx('min-w-0', rail && 'lg:hidden')}>
            <div className="truncate text-sm font-semibold leading-tight">{appName}</div>
            <div className="text-xs text-muted">Maʼlumotnoma</div>
          </div>
          <button onClick={() => setOpen(false)} className="ml-auto rounded-lg p-1.5 text-muted hover:bg-surface-2 lg:hidden" aria-label="Yopish">
            <Ico.close />
          </button>
        </div>

        <nav className="flex-1 space-y-6 overflow-y-auto">
          {inPanel && panel && !rail ? (
            <div className="animate-fade-in">
              <Link
                href={panel.back.href}
                className="mb-4 flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg"
              >
                <Ico.chevronLeft size={18} />
                {panel.back.label}
              </Link>
              <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
                {panel.title}
              </div>
              <div className="space-y-1">{panel.items.map(renderItem)}</div>
              {!panel.items.length && panel.emptyLabel && (
                <p className="px-3 py-2 text-xs text-muted">{panel.emptyLabel}</p>
              )}
            </div>
          ) : (
            sections.map((s) => (
              <div key={s.label}>
                <div className={cx('px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted', rail && 'lg:hidden')}>{s.label}</div>
                <div className="space-y-1">{s.items.map(renderItem)}</div>
              </div>
            ))
          )}
        </nav>

        <div className="mt-4 border-t border-line pt-4">
          <div className={cx('mb-3 flex items-center gap-2.5', rail && 'lg:justify-center')}>
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold">
              {user.fullName.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
            </div>
            <div className={cx('min-w-0', rail && 'lg:hidden')}>
              <div className="truncate text-sm font-medium">{user.fullName}</div>
              {user.roleLabel && <div className="truncate text-xs text-muted">{user.roleLabel}</div>}
            </div>
          </div>
          <form action={logoutAction} method="post">
            <button className={cx('btn-ghost w-full', rail && 'lg:px-0')} title="Chiqish">
              <Ico.logout size={18} />
              <span className={cx(rail && 'lg:hidden')}>Chiqish</span>
            </button>
          </form>
        </div>
      </aside>

      <div className={cx('transition-all duration-300', rail ? 'lg:pl-[88px]' : 'lg:pl-[290px]')}>
        <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-line bg-bg/80 px-4 backdrop-blur-xl md:px-6">
          <button onClick={() => setOpen(true)} className="rounded-lg p-2 text-muted hover:bg-surface-2 lg:hidden" aria-label="Menyu">
            <Ico.menu />
          </button>
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="hidden rounded-lg p-2 text-muted hover:bg-surface-2 lg:block"
            aria-label={collapsed ? 'Panelni ochish' : 'Panelni yigʻish'}
            title={collapsed ? 'Panelni ochish' : 'Panelni yigʻish'}
          >
            <PanelToggle className="h-5 w-5" open={!collapsed} />
          </button>
          <h1 className="truncate text-sm font-semibold">{current?.label ?? appName}</h1>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
          </div>
        </header>

        <main className="p-4 md:p-6 lg:p-8">
          <div className="mx-auto max-w-screen-2xl animate-fade-in">{children}</div>
        </main>
      </div>
    </div>
  );
}
