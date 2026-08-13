'use client';

import React, { useRef, useState } from 'react';

// «Umumiy statistika» — one click, a cross-firm talabnoma overview .xlsx (Firmalar summary +
// Barcha talabnomalar with PINFL, filterable). Replaces the packet-bulk widget above the
// Talabnoma client list. Snapshot-scoped; nothing is generated server-side except the workbook.
export function TalabnomaStat({ snapshotId }: { snapshotId?: number }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inFlight = useRef(false);

  const download = async () => {
    if (snapshotId == null || inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/konveyer/talabnoma-overview-excel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshotId }),
      });
      if (!res.ok) { let e = 'Statistika yaratilmadi'; try { e = (await res.json()).error || e; } catch {} throw new Error(e); }
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') || '';
      const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = m ? decodeURIComponent(m[1]) : 'Talabnoma_umumiy.xlsx';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Statistika yaratilmadi'); }
    finally { setBusy(false); inFlight.current = false; }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={download}
        disabled={busy || snapshotId == null}
        aria-busy={busy}
        className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-fg outline-none transition-colors hover:border-brand-500/40 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:cursor-not-allowed disabled:opacity-50"
        title="Hamma firma boʻyicha umumiy talabnoma statistikasi (Excel, PINFL bilan)"
      >
        {busy
          ? <><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> Tayyorlanmoqda…</>
          : <><svg className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><rect x="7" y="10" width="3" height="7" /><rect x="12" y="6" width="3" height="11" /><rect x="17" y="13" width="3" height="4" /></svg> Umumiy statistika</>}
      </button>
      {err && <span role="alert" className="text-[11px] font-medium text-rose-500">{err}</span>}
    </div>
  );
}
