'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface Transition {
  from: string;
  fromLabel: string;
  count: number;
  to: string;
  toLabel: string;
  /** Sends out via xat.hippo / adolat — defaults to 1 so a test can't fire the whole batch. */
  external?: boolean;
}

function Row({ firmId, t }: { firmId: number; t: Transition }) {
  const router = useRouter();
  const [count, setCount] = useState<number>(t.external ? 1 : t.count);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/konveyer/advance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firmId, from: t.from, to: t.to, count }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Xato');
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? 'Xato');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-muted" title={t.fromLabel}>{t.fromLabel} · <span className="tabular-nums font-medium text-fg">{t.count}</span></span>
        <input
          type="number"
          min={1}
          max={t.count}
          value={count}
          onChange={(e) => setCount(Math.max(1, Math.min(t.count, Number(e.target.value) || 0)))}
          className="w-16 shrink-0 rounded-md border border-line bg-surface px-2 py-1 tabular-nums outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
          aria-label={`${t.fromLabel} soni`}
        />
        <button
          onClick={go}
          disabled={busy}
          aria-busy={busy}
          className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand-500/30 ${t.external ? 'bg-amber-500/15 text-amber-700 hover:bg-amber-500/25 dark:text-amber-300' : 'btn-ghost'}`}
          title={t.external ? 'Tashqi yuborish — test uchun default 1 ta' : undefined}
        >
          {busy && <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}
          → {t.toLabel}
          {t.external && <span className="ml-1 text-[10px] opacity-70">(test 1)</span>}
        </button>
      </div>
      {err && <div role="alert" className="mt-1 text-rose-500">{err}</div>}
    </div>
  );
}

export function AdvanceControls({ firmId, transitions }: { firmId: number; transitions: Transition[] }) {
  if (transitions.length === 0) return null;
  return (
    <div className="mt-3 space-y-1.5 border-t border-line pt-3">
      {transitions.map((t) => (
        <Row key={t.from} firmId={firmId} t={t} />
      ))}
    </div>
  );
}
