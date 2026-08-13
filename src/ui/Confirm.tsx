'use client';

import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Modal } from './Modal';

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const Ctx = createContext<ConfirmFn | null>(null);

/**
 * ONE app-wide confirmation modal. Replaces the native window.confirm() everywhere with the nice
 * <Modal>. Usage: `const confirm = useConfirm(); if (!(await confirm({ title, description, danger })))
 * return;` The dialog closes as soon as the user chooses — the caller runs its own action (and its
 * own loading state) after the promise resolves.
 */
export function useConfirm(): ConfirmFn {
  const fn = useContext(Ctx);
  if (!fn) throw new Error('useConfirm must be used within <ConfirmProvider>');
  return fn;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((o) => new Promise<boolean>((resolve) => {
    resolver.current = resolve;
    setOpts(o);
  }), []);

  const settle = (v: boolean) => {
    const r = resolver.current;
    resolver.current = null;
    setOpts(null);
    r?.(v);
  };

  return (
    <Ctx.Provider value={confirm}>
      {children}
      <Modal
        open={opts !== null}
        onClose={() => settle(false)}
        title={opts?.title ?? ''}
        description={opts?.description}
        size="sm"
        footer={opts ? (
          <>
            <button
              type="button"
              onClick={() => settle(false)}
              className="rounded-lg border border-line px-3.5 py-1.5 text-xs font-medium text-muted outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand-500/30"
            >
              {opts.cancelLabel ?? 'Bekor'}
            </button>
            <button
              type="button"
              autoFocus
              onClick={() => settle(true)}
              className={
                'inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm outline-none transition-colors focus-visible:ring-2 ' +
                (opts.danger ? 'bg-rose-500 hover:bg-rose-600 focus-visible:ring-rose-500/40' : 'bg-brand-500 hover:bg-brand-600 focus-visible:ring-brand-500/40')
              }
            >
              {opts.confirmLabel ?? 'Ha'}
            </button>
          </>
        ) : null}
      />
    </Ctx.Provider>
  );
}
