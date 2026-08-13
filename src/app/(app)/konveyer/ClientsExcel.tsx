'use client';

import React, { useRef, useState } from 'react';
import { Ico } from '@/ui';

// «Excel» — download the current Mijozlar list (this phase × firm × stages) as a data .xlsx.
// Replaces the packet-bulk builder in every client-list header. One click, no modal.
export function ClientsExcel({ firmId, snapshotId, stages = [], talabnoma = false }: {
  firmId?: number; snapshotId?: number; stages?: string[]; talabnoma?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inFlight = useRef(false);

  const download = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setErr(null);
    try {
      const params = new URLSearchParams();
      if (firmId != null) params.set('firmId', String(firmId));
      if (snapshotId != null) params.set('s', String(snapshotId));
      if (stages.length) params.set('stages', stages.join(','));
      if (talabnoma) params.set('talabnoma', '1');
      const res = await fetch(`/konveyer/cases-excel?${params.toString()}`);
      if (!res.ok) { let e = 'Excel yaratilmadi'; try { e = (await res.json()).error || e; } catch {} throw new Error(e); }
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') || '';
      const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = m ? decodeURIComponent(m[1]) : 'Mijozlar.xlsx';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Excel yaratilmadi'); }
    finally { setBusy(false); inFlight.current = false; }
  };

  return (
    <div className="inline-flex items-center gap-2">
      {err && <span role="alert" className="text-[11px] font-medium text-rose-500">{err}</span>}
      <button
        onClick={download}
        disabled={busy}
        aria-busy={busy}
        className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-fg outline-none transition-colors hover:border-brand-500/40 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:cursor-wait disabled:opacity-60"
        title="Mijozlar roʻyxatini Excel (data) qilib yuklab olish"
      >
        {busy
          ? <><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> Tayyorlanmoqda…</>
          : <><Ico.sheet size={15} className="text-emerald-600 dark:text-emerald-400" /> Excel</>}
      </button>
    </div>
  );
}
