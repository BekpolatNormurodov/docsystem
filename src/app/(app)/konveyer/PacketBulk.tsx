'use client';

import React, { useEffect, useState } from 'react';

// Bulk "umumiy yaratish": generate the full packet for every case in the current
// firm/phase scope and download one big ZIP (a subfolder per person). PDF
// rendering is slow, so it's an opt-in that lowers the per-request cap.
export function PacketBulk({ firmId, snapshotId, stages, scopeLabel }: {
  firmId?: number; snapshotId?: number; stages: string[]; scopeLabel: string;
}) {
  const [busy, setBusy] = useState(false);
  const [withPdf, setWithPdf] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Clear a prior result when the scope changes so "5 ta paket tayyor" isn't
  // misread as belonging to the newly-selected firm/phase.
  useEffect(() => { setMsg(null); setErr(null); }, [firmId, snapshotId, stages.join(',')]);

  const run = async () => {
    setBusy(true); setMsg(null); setErr(null);
    try {
      const res = await fetch('/konveyer/gen-packet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firmId, snapshotId, stages, talabnomaPdf: withPdf }),
      });
      if (!res.ok) { let e = 'Xatolik'; try { e = (await res.json()).error || e; } catch {} setErr(e); return; }
      const made = res.headers.get('X-Generated');
      const dropped = Number(res.headers.get('X-Dropped') || '0');
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') || '';
      const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
      const name = m ? decodeURIComponent(m[1]) : 'Paketlar.zip';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      setMsg(`${made} ta paket tayyor${dropped > 0 ? ` · ${dropped} ta chegaradan tashqarida qoldi` : ''}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Tarmoq xatosi');
    } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:border-brand-500/30" title="Talabnoma PDF ham qo'shiladi (sekinroq, ko'pi bilan 60 ta)">
        <input type="checkbox" checked={withPdf} onChange={(e) => setWithPdf(e.target.checked)} className="h-3 w-3 accent-brand-500" />
        Talabnoma PDF
      </label>
      <button
        onClick={run}
        disabled={busy}
        aria-busy={busy}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm outline-none transition-all hover:bg-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:cursor-wait disabled:opacity-70"
        title={`«${scopeLabel}» bo'yicha hammaga paket yaratish`}
      >
        {busy
          ? <><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" /> Yaratilmoqda…</>
          : <><svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" /></svg> Paket yaratish</>}
      </button>
      {msg && <span role="status" aria-live="polite" className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">{msg}</span>}
      {err && <span role="alert" className="text-[11px] font-medium text-rose-500">{err}</span>}
    </div>
  );
}
