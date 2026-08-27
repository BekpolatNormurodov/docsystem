'use client';

// MIB monitoring — konveyer step'laridan PASTDA, alohida bo'lim. Voronkada "sudda yutib ijroga
// chiqqanlar" (MIB bosqichi) uchun standalone «MIB hisoboti»ning to'liq mib.uz ko'rinishini moslaydi:
// bir tugma bilan konveyerdan PINFL'lar urug'lanadi, so'ng o'sha ReportPanel (GO → mib.uz pull →
// to'liq natija) shu yerda ishlaydi. Standalone MIB hisoboti moduliga tegmaydi (u alohida turadi).
import React, { useCallback, useEffect, useState } from 'react';
import { Ico, Spinner, useConfirm } from '@/ui';
import { ReportPanel } from '../mib-hisoboti/MibReport';

interface Scope {
  snapshotId?: number;
  reportId: number | null;
  mibCases: number;
  seeded: number;
}

export function KonveyerMibMonitor({ snapshotId }: { snapshotId?: number }) {
  const confirm = useConfirm();
  const [scope, setScope] = useState<Scope | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);

  const qs = snapshotId ? `?s=${snapshotId}` : '';
  const loadScope = useCallback(async () => {
    const r = await fetch(`/konveyer/mib/report${qs}`, { cache: 'no-store' });
    const j = await r.json().catch(() => null);
    setScope(j);
  }, [qs]);
  useEffect(() => { void loadScope(); }, [loadScope]);

  // Konveyerdan urug'lantirish (idempotent) — mavjud report bo'lsa yangi PINFL'larni qo'shadi.
  const seed = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await fetch('/konveyer/mib/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshotId }),
      });
      const j = await r.json().catch(() => null);
      if (j?.reportId) {
        setScope((s) => ({
          snapshotId,
          reportId: j.reportId as number,
          mibCases: s?.mibCases ?? (j.total as number),
          seeded: j.total as number,
        }));
      }
    } finally {
      setBusy(false);
    }
  }, [snapshotId]);

  const n = (x: number) => x.toLocaleString('ru-RU');

  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-5 py-4 text-left"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-teal-500/12 text-teal-600 dark:text-teal-300" aria-hidden>
            <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18" /><path d="M6 21V10l6-4 6 4v11" /><path d="M10 21v-5h4v5" /></svg>
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">MIB monitoring</span>
              <span className="badge border-teal-500/30 text-teal-600 dark:text-teal-300">mib.uz · real</span>
            </div>
            <div className="mt-0.5 truncate text-xs text-muted">
              Sudda yutib ijroga chiqqanlar — mib.uz dan to'liq ma'lumot (step qatoridan tashqari)
            </div>
          </div>
        </div>
        <svg className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 6 6 6-6 6" /></svg>
      </button>

      {open && (
        <div className="border-t border-line px-5 pb-5 pt-4">
          {scope === null ? (
            <div className="grid place-items-center py-8"><Spinner /></div>
          ) : scope.mibCases === 0 ? (
            <div className="rounded-xl border border-dashed border-line bg-surface-2/40 px-3 py-6 text-center text-xs text-muted">
              Konveyerda MIBga chiqqan (ijroga o'tgan) ish topilmadi.
              <div className="mt-1 text-[11px]">Sud bosqichidan MIB'ga o'tgan ishlar shu yerda mib.uz dan tekshiriladi.</div>
            </div>
          ) : scope.reportId === null ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-sm text-muted">
                Konveyerda MIBga chiqqan <b className="tabular-nums text-fg">{n(scope.mibCases)}</b> ta ish bor.
                «Yuklash» bosilsa ular mib.uz dan tekshirish ro'yxatiga olinadi.
              </p>
              <button className="btn-primary" disabled={busy} onClick={() => void seed()}>
                {busy ? <Spinner size={16} className="mr-1.5" /> : <Ico.download size={16} className="mr-1.5 inline" />}
                Konveyerdan yuklash ({n(scope.mibCases)} ta)
              </button>
            </div>
          ) : (
            <ReportPanel
              reportId={scope.reportId}
              confirm={confirm}
              onChanged={loadScope}
              embedded
              reseed={seed}
            />
          )}
        </div>
      )}
    </div>
  );
}
