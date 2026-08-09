'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';

interface InboxFile { name: string; size: number; at: string }
const kb = (n: number) => `${Math.max(1, Math.round(n / 1024)).toLocaleString('ru-RU')} KB`;
const dt = (iso: string) => { const d = new Date(iso); const p = (x: number) => String(x).padStart(2, '0'); return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`; };

// Palata step: upload the signed/stamped scanned arizas that came back from the
// chamber — in bulk (one long scan) or one by one. Stored in an inbox awaiting
// split/assignment to cases.
interface PickCase { caseId: number; clientName: string | null; firmName: string; stageLabel: string }

export function PalataPanel() {
  const [files, setFiles] = useState<InboxFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [assign, setAssign] = useState<string | null>(null); // inbox file being assigned
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PickCase[]>([]);
  const [searching, setSearching] = useState(false);
  const [assigningId, setAssigningId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await fetch('/konveyer/palata-upload');
      if (!res.ok) throw new Error(`Server xatosi (${res.status})`);
      const data = await res.json();
      setFiles(data.files ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Yuklab bo‘lmadi');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Search cases (by name/kod/PINFL) to attach a scan to.
  useEffect(() => {
    if (!assign) return;
    let alive = true; // ignore this run's response if q/assign changed (out-of-order guard)
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/konveyer/cases?pageSize=8${q ? `&q=${encodeURIComponent(q)}` : ''}`);
        const data = await res.json();
        const flat: PickCase[] = (data.persons ?? []).flatMap((p: any) =>
          (p.cases ?? []).map((c: any) => ({ caseId: c.caseId, clientName: p.clientName, firmName: c.firmName, stageLabel: c.stageLabel })));
        if (alive) setResults(flat.slice(0, 12));
      } catch { if (alive) setResults([]); }
      finally { if (alive) setSearching(false); }
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [assign, q]);

  const doAssign = async (caseId: number) => {
    if (!assign) return;
    setAssigningId(caseId); setErr(null);
    try {
      const res = await fetch('/konveyer/palata-assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file: assign, caseId }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d?.error ?? 'Biriktirib bo‘lmadi'); }
      setAssign(null); setQ(''); setResults([]);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Biriktirib bo‘lmadi');
    } finally { setAssigningId(null); }
  };

  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list || list.length === 0) return;
    setBusy(true); setErr(null);
    try {
      const fd = new FormData();
      Array.from(list).forEach((f) => fd.append('files', f));
      const res = await fetch('/konveyer/palata-upload', { method: 'POST', body: fd });
      if (!res.ok) throw new Error('Yuklab bo‘lmadi');
      await load();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Yuklab bo‘lmadi');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
      setBusy(false);
    }
  };

  const del = async (name: string) => {
    try {
      const res = await fetch(`/konveyer/palata-upload?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('O‘chirib bo‘lmadi');
      setFiles((f) => f.filter((x) => x.name !== name));
    } catch (e) { setErr(e instanceof Error ? e.message : 'O‘chirib bo‘lmadi'); }
  };

  return (
    <div className="card p-4">
      <div className="mb-3">
        <div className="text-sm font-semibold">Palatadan kelgan imzolangan arizalar</div>
        <div className="mt-0.5 text-xs text-muted">Uzun skanni yoki bittalab yuklang — keyin arizalarga ajratiladi.</div>
      </div>

      <div
        role="button"
        tabIndex={0}
        aria-label="Skanerlangan PDF yuklash"
        aria-busy={busy}
        onClick={() => !busy && fileRef.current?.click()}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !busy) { e.preventDefault(); fileRef.current?.click(); } }}
        className="flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 border-dashed border-violet-500/30 bg-violet-500/[0.04] px-4 py-6 text-center outline-none transition-colors hover:border-violet-500/50 focus-visible:border-violet-500 focus-visible:ring-2 focus-visible:ring-violet-500/30 aria-busy:cursor-wait"
      >
        {busy
          ? <span className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500/30 border-t-violet-500" />
          : <svg className="h-7 w-7 text-violet-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M5 20h14" /></svg>}
        <div className="text-sm font-medium">{busy ? 'Yuklanmoqda…' : 'Skanerlangan PDF(lar)ni yuklang'}</div>
        <div className="text-[11px] text-muted">bosing yoki tashlang · PDF · bir nechta</div>
        <input ref={fileRef} type="file" multiple accept=".pdf" className="hidden" onChange={onFiles} />
      </div>

      {err && (
        <div role="alert" className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-rose-500/25 bg-rose-500/[0.04] px-2.5 py-1.5 text-[11px] font-medium text-rose-500">
          <span>{err}</span>
          <button onClick={() => { setLoading(true); load(); }} className="shrink-0 rounded border border-line px-1.5 py-0.5 text-muted hover:border-brand-500/40">Qayta urinish</button>
        </div>
      )}

      {loading ? (
        <div className="mt-3 space-y-1">
          <div className="mb-1.5 h-3 w-40 animate-pulse rounded bg-surface-2" />
          {Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-8 w-full animate-pulse rounded-lg bg-surface-2" />)}
        </div>
      ) : err && files.length === 0 ? null /* the error banner above already covers it — no contradictory "nothing yet" */
      : files.length === 0 ? (
        <div className="mt-3 text-center text-[11px] text-muted">Hali skan yuklanmagan.</div>
      ) : (
        <div className="mt-3">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Tarix — yuklangan skanlar · {files.length}</div>
          <ul className="space-y-1">
            {files.map((f) => (
              <li key={f.name} className="rounded-lg border border-line bg-surface">
                <div className="flex items-center gap-2 px-2.5 py-1.5 text-xs">
                  <span className="rounded bg-violet-500/12 px-1.5 py-0.5 text-[10px] font-medium text-violet-600 dark:text-violet-300">skan</span>
                  <span className="min-w-0 flex-1 truncate">{f.name.replace(/^\d+-\d+-/, '')}</span>
                  <span className="shrink-0 text-[10px] tabular-nums text-muted">{dt(f.at)}</span>
                  <span className="shrink-0 tabular-nums text-muted">{kb(f.size)}</span>
                  <button onClick={() => { setAssign(assign === f.name ? null : f.name); setQ(''); }} aria-expanded={assign === f.name} className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[11px] font-medium text-brand-600 hover:border-brand-500/40 dark:text-brand-400">→ Arizaga</button>
                  <button onClick={() => del(f.name)} className="shrink-0 text-rose-500 hover:text-rose-600" aria-label="O'chirish">✕</button>
                </div>
                {assign === f.name && (
                  <div className="border-t border-line p-2">
                    <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus aria-label="Mijoz qidirish" placeholder="Mijoz qidirish (F.I.O, PINFL)…" className="mb-1.5 w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15" />
                    {searching ? (
                      <div className="flex items-center justify-center gap-2 py-2 text-[11px] text-muted"><span className="h-3 w-3 animate-spin rounded-full border-2 border-muted/40 border-t-muted" /> Qidirilmoqda…</div>
                    ) : results.length === 0 ? (
                      <div className="py-2 text-center text-[11px] text-muted">{q ? 'Topilmadi' : 'Qidiring…'}</div>
                    ) : (
                      <ul className="max-h-44 space-y-1 overflow-auto">
                        {results.map((c) => (
                          <li key={c.caseId}>
                            <button onClick={() => doAssign(c.caseId)} disabled={assigningId != null} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-surface-2 disabled:opacity-50">
                              {assigningId === c.caseId && <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-brand-500/40 border-t-brand-500" />}
                              <span className="min-w-0 flex-1 truncate font-medium">{c.clientName || '—'}</span>
                              <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">{c.firmName}</span>
                              <span className="shrink-0 text-[10px] text-muted">{c.stageLabel}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-2 text-[11px] text-muted">Bittalab biriktirish pastdagi mijoz kartasidan ham mumkin.</div>
        </div>
      )}
    </div>
  );
}
