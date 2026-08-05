'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Ico } from './icons';

/**
 * A table row that navigates on click (and on Enter). Prefetches on hover so the
 * detail page opens instantly. Nested buttons must call stopPropagation.
 */
export function ClickableRow({
  href,
  children,
  title = 'Ochish',
}: {
  href: string;
  children: React.ReactNode;
  title?: string;
}) {
  const router = useRouter();
  return (
    <tr
      onClick={() => router.push(href)}
      onMouseEnter={() => router.prefetch(href)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') router.push(href);
      }}
      tabIndex={0}
      role="link"
      aria-label={title}
      className="cursor-pointer border-t border-line transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/40"
    >
      {children}
    </tr>
  );
}

/** Small icon-only action button for table rows. */
export function RowAction({
  onClick,
  label,
  tone = 'default',
  children,
}: {
  onClick?: (e: React.MouseEvent) => void;
  label: string;
  tone?: 'default' | 'danger';
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      className={`cursor-pointer rounded-lg border border-line p-1.5 transition-colors ${
        tone === 'danger'
          ? 'text-muted hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-300'
          : 'text-muted hover:border-brand-500/40 hover:bg-brand-500/10 hover:text-brand-600 dark:hover:text-brand-400'
      }`}
    >
      {children}
    </button>
  );
}

/** View (eye) action — navigates, stops the row handler from double-firing. */
export function ViewAction({ href }: { href: string }) {
  const router = useRouter();
  return (
    <RowAction label="Ochish" onClick={() => router.push(href)}>
      <Ico.eye size={16} />
    </RowAction>
  );
}
