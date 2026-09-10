'use client';

// MIB monitoring — konveyer step'laridan PASTDA, alohida bo'lim. Voronkada "sudda yutib ijroga
// chiqqanlar" (MIB bosqichi) uchun MODAL ichida to'liq mib.uz operator paneli ochiladi: bir tugma
// bilan konveyerdan PINFL'lar urug'lanadi, so'ng «Ochish» — filtrlanadigan (region / hudud / bank /
// firma), summalar va sahifalash bilan MibDashboard. Standalone «MIB hisoboti» moduliga tegmaydi.
import React, { useCallback, useEffect, useState } from 'react';
import { Ico, Spinner, Modal } from '@/ui';
import { MibDashboard } from './MibDashboard';

interface Scope { snapshotId?: number; reportId: number | null; mibCases: number; seeded: number }

const n = (x: number) => (x || 0).toLocaleString('ru-RU');

export function KonveyerMibMonitor({ snapshotId }: { snapshotId?: number }) {
  const [scope, setScope] = useState<Scope | null>(null);
  const [busy, setBusy] = useState(false);
  const [openModal, setOpenModal] = useState(false);

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
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ snapshotId }),
      });
      const j = await r.json().catch(() => null);
      if (j?.reportId) setScope((s) => ({ snapshotId, reportId: j.reportId as number, mibCases: s?.mibCases ?? (j.total as number), seeded: j.total as number }));
    } finally { setBusy(false); }
  }, [snapshotId]);

  const hasReport = !!scope && scope.reportId !== null;
  const unseeded = scope ? Math.max(0, scope.mibCases - scope.seeded) : 0;

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-teal-500/12 text-teal-600 dark:text-teal-300" aria-hidden>
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18" /><path d="M6 21V10l6-4 6 4v11" /><path d="M10 21v-5h4v5" /></svg>
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">MIB monitoring</span>
              <span className="badge border-teal-500/30 text-teal-600 dark:text-teal-300">mib.uz · real</span>
            </div>
            <div className="mt-0.5 text-xs text-muted">
              {scope === null ? 'Yuklanmoqda…'
                : scope.mibCases === 0 ? 'Konveyerda MIBga chiqqan ish topilmadi.'
                : hasReport ? <>Konveyerda <b className="text-fg tabular-nums">{n(scope.mibCases)}</b> ta · <b className="text-fg tabular-nums">{n(scope.seeded)}</b> tekshiruvga olingan{unseeded > 0 ? <> · <span className="text-amber-600 dark:text-amber-300">{n(unseeded)} yangi</span></> : ''}</>
                : <>Konveyerda <b className="text-fg tabular-nums">{n(scope.mibCases)}</b> ta MIB ishi — tekshiruvga oling</>}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {scope === null ? <Spinner size={18} />
            : scope.mibCases === 0 ? null
            : hasReport ? (
              <>
                {unseeded > 0 && (
                  <button className="btn-ghost" disabled={busy} onClick={() => void seed()} title="Yangi PINFL'larni qo'shish">
                    {busy ? <Spinner size={16} /> : <Ico.refresh size={16} />} Yangilash
                  </button>
                )}
                <button className="btn-primary" onClick={() => setOpenModal(true)}>
                  <Ico.dashboard size={16} /> Ochish
                </button>
              </>
            ) : (
              <button className="btn-primary" disabled={busy} onClick={() => void seed()}>
                {busy ? <Spinner size={16} className="mr-1.5" /> : <Ico.download size={16} className="mr-1.5 inline" />}
                Konveyerdan yuklash ({n(scope.mibCases)})
              </button>
            )}
        </div>
      </div>

      <Modal
        open={openModal && hasReport}
        onClose={() => setOpenModal(false)}
        size="full"
        title="MIB monitoring — ijro ishlari"
        description="Sudda yutib ijroga chiqqanlar · mib.uz dan real maʼlumot · region / hudud / bank boʻyicha filtr"
      >
        {hasReport && scope!.reportId != null && <MibDashboard reportId={scope!.reportId} reseed={seed} />}
      </Modal>
    </div>
  );
}
