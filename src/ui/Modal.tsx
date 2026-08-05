'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Ico } from './icons';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Static classes only — Tailwind's JIT cannot see interpolated class names. */
const SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
} as const;

export function Modal({
  open,
  title,
  description,
  children,
  footer,
  onClose,
  size = 'md',
}: {
  open: boolean;
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  onClose: () => void;
  size?: keyof typeof SIZES;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  // createPortal needs a real document; the server render has none.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Escape route (Apple HIG): Esc always dismisses. Tab stays inside — `aria-modal` tells a
  // screen reader the rest of the page is inert, but it does not stop the keyboard walking out
  // into it, which leaves the user tabbing through a page they cannot see.
  useEffect(() => {
    if (!open) return;

    restoreTo.current = document.activeElement as HTMLElement | null;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panel.current) return;

      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null,
      );
      if (items.length === 0) return;

      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;

      // Wrap at both ends, and pull focus in if it somehow escaped (e.g. a re-render).
      if (!panel.current.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    // The page behind must not scroll under an open dialog.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      // Send focus back where it came from, so closing does not dump the user at the page top.
      restoreTo.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  /*
    Rendered into <body>, not where it is written.

    `position: fixed` is only relative to the viewport while no ancestor has a transform, filter
    or backdrop-filter — any of those makes the ancestor the containing block instead. AppShell
    wraps every page in `animate-fade-in`, whose keyframes hold a transform, so the dialog was
    being centred on the content column and the dim stopped at the sidebar. Measured: the same
    markup lands at centerX 785 inside a transformed wrapper versus 640 (the viewport centre)
    outside it.

    The fill-mode is fixed too, but that only removes today's culprit. Portalling removes the
    whole class: no ancestor can reach it here.
  */
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      {/* Plain dim, no backdrop-blur — blur over a near-black page just reads as a black smear.
          The panel separates on its border + shadow instead. */}
      <div
        className="absolute inset-0 bg-slate-900/25 dark:bg-slate-950/40"
        onClick={onClose}
        aria-hidden
      />
      <div ref={panel} className={`card relative w-full ${SIZES[size]} p-6 shadow-2xl animate-fade-in`}>
        <button
          onClick={onClose}
          className="absolute right-4 top-4 cursor-pointer rounded-lg p-1 text-muted hover:bg-surface-2 hover:text-fg"
          aria-label="Yopish"
          type="button"
        >
          <Ico.close size={18} />
        </button>
        <h3 className="pr-8 text-base font-semibold">{title}</h3>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
        <div className="mt-4">{children}</div>
        {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
