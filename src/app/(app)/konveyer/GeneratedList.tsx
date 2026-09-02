'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Ico } from '@/ui';

interface GenItem { caseId: number; pinfl: string | null; clientName: string | null; firmName: string | null; courtName: string | null; receiptNumber?: string | null; at: string | null }
const n = (x: number) => x.toLocaleString('ru-RU');
const fmtWhen = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); };

/**
 * «Yaratilganlar» — qaysi mijozларга ariza/oferta yaratilgan (arizaAt/ofertaAt bo'yicha): PINFL + F.I.O
 * + firma + sud + sana. Sahifalab (50 ta), PINFL/ism bo'yicha qidiruv. Umumiy Excel skachat + har bir
 * mijoz uchun alohida yuklab olish (ariza .docx / oferta .zip). `count` — «N ta chiqdi» sarlavhasi.
 */
export function GeneratedList({ type, snapshotId, firmId, count }: { type: 'ariza' | 'oferta' | 'invoice'; snapshotId?: number; firmId?: number; count: number }) {
  const label = type === 'invoice' ? 'invoyslar' : type === 'oferta' ? 'ofertalar' : 'arizalar';
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<GenItem[] | null>(null);
  const [total, setTotal] = useState(count);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const reqRef = useRef(0);

  const params = useCallback((extra: Record<string, string>) => {
    const p = new URLSearchParams({ type, ...extra });
    if (snapshotId != null) p.set('snapshotId', String(snapshotId));
    if (firmId != null) p.set('firmId', String(firmId));
    if (q.trim()) p.set('q', q.trim());
    return p.toString();
  }, [type, snapshotId, firmId, q]);

  const load = useCallback(async (query: string, pg: number) => {
    if (snapshotId == null) return;
    const my = ++reqRef.current;
    setLoading(true);
    const p = new URLSearchParams({ snapshotId: String(snapshotId), type, page: String(pg) });
    if (firmId != null) p.set('firmId', String(firmId));
    if (query.trim()) p.set('q', query.trim());
    try {
      const res = await fetch(`/konveyer/generated?${p.toString()}`);
      const d = res.ok ? await res.json() : null;
      if (my !== reqRef.current) return;
      setItems(Array.isArray(d?.items) ? d.items : []);
      setTotal(typeof d?.total === 'number' ? d.total : 0);
      setPages(typeof d?.pages === 'number' ? d.pages : 1);
      setPage(typeof d?.page === 'number' ? d.page : pg);
    } catch { if (my === reqRef.current) setItems([]); }
    finally { if (my === reqRef.current) setLoading(false); }
  }, [snapshotId, firmId, type]);

  // Scope o'zgarsa yopib qo'yamiz (eski ro'yxat qolib ketmasin).
  useEffect(() => { setOpen(false); setItems(null); setQ(''); setPage(1); setTotal(count); }, [snapshotId, firmId, count]);
  useEffect(() => { if (open && items === null) load('', 1); }, [open, items, load]);
  // Qidiruv — debounce, 1-sahifadan.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => load(q, 1), 250);
    return () => clearTimeout(t);
  }, [q, open, load]);

  const go = (pg: number) => { if (pg >= 1 && pg <= pages) load(q, pg); };
  const dlUrl = (it: GenItem) => (type === 'invoice' ? `/konveyer/invoice-pdf?caseId=${it.caseId}` : type === 'oferta' ? `/konveyer/gen-oferta?caseId=${it.caseId}` : `/konveyer/gen-ariza?caseId=${it.caseId}`);
  const dlKind = type === 'invoice' ? 'kvitansiya (.pdf)' : type === 'oferta' ? 'oferta (.zip)' : 'ariza (.docx)';

  if (count <= 0) return null;

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-line">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-2">
        <Ico.check size={14} className="text-emerald-600 dark:text-emerald-400" />
        <span className="text-xs font-semibold">Yaratilgan {label}</span>
        <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">{n(count)}</span>
        <span className="ml-auto text-[11px] text-muted">{open ? 'Yopish' : 'Koʻrish'}</span>
        <Ico.chevron size={14} className={`text-muted transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>

      {open && (
        <div className="border-t border-line">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2">
            <svg className="h-3.5 w-3.5 shrink-0 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="PINFL yoki F.I.O bo'yicha qidirish…"
              className="w-full bg-transparent text-xs outline-none placeholder:text-muted" />
            {loading && <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent text-muted" />}
            {/* Umumiy Excel skachat — hozirgi filtr (qidiruv/firma) bo'yicha butun ro'yxat. */}
            <a href={`/konveyer/generated/excel?${params({})}`}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] font-medium text-emerald-700 transition-colors hover:bg-emerald-500/10 dark:text-emerald-400"
              title="Butun ro'yxatni Excel qilib yuklab olish">
              <Ico.sheet size={12} /> Excel
            </a>
          </div>

          {items === null ? (
            <div className="space-y-1 p-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-8 animate-pulse rounded bg-surface-2" />)}</div>
          ) : items.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted">{q ? 'Topilmadi' : 'Boʻsh'}</div>
          ) : (
            <>
              <div className="divide-y divide-line">
                {items.map((it, i) => (
                  <div key={it.caseId} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                    <span className="w-8 shrink-0 text-right tabular-nums text-muted">{(page - 1) * 50 + i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{it.clientName || '—'}</span>
                      <span className="block truncate text-[11px] tabular-nums text-muted">{it.pinfl || '—'}{it.firmName ? ` · ${it.firmName}` : ''}{type === 'invoice' && it.receiptNumber ? ` · №${it.receiptNumber}` : ''}</span>
                    </span>
                    {it.courtName && <span className="hidden shrink-0 rounded-full border border-line px-1.5 py-0.5 text-[10px] text-muted sm:inline">{it.courtName}</span>}
                    <span className="hidden shrink-0 text-[11px] tabular-nums text-muted sm:inline">{fmtWhen(it.at)}</span>
                    <a href={dlUrl(it)} title={`${it.clientName || 'mijoz'} — ${dlKind} yuklab olish`}
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-brand-500/10 hover:text-brand-600 dark:hover:text-brand-400">
                      <Ico.download size={13} />
                    </a>
                  </div>
                ))}
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2">
                <span className="text-[11px] tabular-nums text-muted">Jami {n(total)} · {page}/{pages}-bet</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => go(page - 1)} disabled={page <= 1 || loading}
                    className="grid h-6 w-6 place-items-center rounded-md border border-line text-muted transition-colors hover:bg-surface-2 disabled:opacity-40">
                    <Ico.chevronLeft size={13} />
                  </button>
                  <button onClick={() => go(page + 1)} disabled={page >= pages || loading}
                    className="grid h-6 w-6 place-items-center rounded-md border border-line text-muted transition-colors hover:bg-surface-2 disabled:opacity-40">
                    <Ico.chevron size={13} />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
