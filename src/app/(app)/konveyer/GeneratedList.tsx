'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Ico } from '@/ui';

interface GenItem { pinfl: string | null; clientName: string | null; firmName: string | null; courtName: string | null; at: string | null }
const n = (x: number) => x.toLocaleString('ru-RU');
const fmtWhen = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); };

/**
 * «Yaratilganlar» — qaysi mijozларга ariza/oferta yaratilgan (arizaAt/ofertaAt bo'yicha): PINFL + F.I.O
 * + firma + sud + sana. Bosilganda ochiladi va serverdan yuklaydi; qidiruv (PINFL yoki ism) bilan.
 * `count` — «N ta chiqdi» sarlavhasi (prepare GET'даги `done`).
 */
export function GeneratedList({ type, snapshotId, firmId, count }: { type: 'ariza' | 'oferta'; snapshotId?: number; firmId?: number; count: number }) {
  const label = type === 'oferta' ? 'ofertalar' : 'arizalar';
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<GenItem[] | null>(null);
  const [total, setTotal] = useState(count);
  const [truncated, setTruncated] = useState(false);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const reqRef = useRef(0);

  const load = useCallback(async (query: string) => {
    if (snapshotId == null) return;
    const my = ++reqRef.current;
    setLoading(true);
    const params = new URLSearchParams({ snapshotId: String(snapshotId), type });
    if (firmId != null) params.set('firmId', String(firmId));
    if (query.trim()) params.set('q', query.trim());
    try {
      const res = await fetch(`/konveyer/generated?${params.toString()}`);
      const d = res.ok ? await res.json() : null;
      if (my !== reqRef.current) return;
      setItems(Array.isArray(d?.items) ? d.items : []);
      setTotal(typeof d?.total === 'number' ? d.total : 0);
      setTruncated(!!d?.truncated);
    } catch { if (my === reqRef.current) setItems([]); }
    finally { if (my === reqRef.current) setLoading(false); }
  }, [snapshotId, firmId, type]);

  // Ochilganda birinchi yuklash; scope o'zgarsa yopib qo'yamiz (eski ro'yxat qolib ketmasin).
  useEffect(() => { setOpen(false); setItems(null); setQ(''); setTotal(count); }, [snapshotId, firmId, count]);
  useEffect(() => { if (open && items === null) load(''); }, [open, items, load]);
  // Qidiruv — debounce.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => load(q), 250);
    return () => clearTimeout(t);
  }, [q, open, load]);

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
            <span className="shrink-0 text-[11px] tabular-nums text-muted">{n(total)}</span>
          </div>

          {items === null ? (
            <div className="space-y-1 p-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-8 animate-pulse rounded bg-surface-2" />)}</div>
          ) : items.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted">{q ? 'Topilmadi' : 'Boʻsh'}</div>
          ) : (
            <>
              <div className="max-h-[22rem] overflow-y-auto divide-y divide-line">
                {items.map((it, i) => (
                  <div key={`${it.pinfl}-${i}`} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                    <span className="w-6 shrink-0 text-right tabular-nums text-muted">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{it.clientName || '—'}</span>
                      <span className="block truncate text-[11px] tabular-nums text-muted">{it.pinfl || '—'}{it.firmName ? ` · ${it.firmName}` : ''}</span>
                    </span>
                    {it.courtName && <span className="hidden shrink-0 rounded-full border border-line px-1.5 py-0.5 text-[10px] text-muted sm:inline">{it.courtName}</span>}
                    <span className="shrink-0 text-[11px] tabular-nums text-muted">{fmtWhen(it.at)}</span>
                  </div>
                ))}
              </div>
              {truncated && <div className="border-t border-line px-3 py-1.5 text-center text-[11px] text-muted">Faqat birinchi {n(items.length)} ta koʻrsatildi — qidiruvдан foydalaning.</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
