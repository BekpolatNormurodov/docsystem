'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Ico, Select } from '@/ui';

type InvStatus = 'created' | 'paid' | 'court' | 'notmade';
interface GenItem { caseId: number; pinfl: string | null; clientName: string | null; firmName: string | null; courtName: string | null; receiptNumber?: string | null; status?: InvStatus | null; at: string | null }
const n = (x: number) => x.toLocaleString('ru-RU');
// Invoice holati (progress) rangi.
const STATUS: Record<InvStatus, { label: string; cls: string }> = {
  notmade: { label: 'Chiqarilmagan', cls: 'border-line bg-surface-2 text-muted' },
  created: { label: 'Toʻlanmagan', cls: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  paid: { label: 'Toʻlandi', cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
  court: { label: 'Sudda', cls: 'border-brand-500/30 bg-brand-500/10 text-brand-700 dark:text-brand-300' },
};
const INV_FILTERS = [['made', 'Chiqarilgan'], ['notmade', 'Chiqarilmagan'], ['all', 'Hammasi']] as const;
const fmtWhen = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); };

/**
 * «Yaratilganlar» — qaysi mijozларга ariza/oferta yaratilgan (arizaAt/ofertaAt bo'yicha): PINFL + F.I.O
 * + firma + sud + sana. Sahifalab (50 ta), PINFL/ism bo'yicha qidiruv. Umumiy Excel skachat + har bir
 * mijoz uchun alohida yuklab olish (ariza .docx / oferta .zip). `count` — «N ta chiqdi» sarlavhasi.
 */
export function GeneratedList({ type, snapshotId, firmId, firms, count }: { type: 'ariza' | 'oferta' | 'invoice'; snapshotId?: number; firmId?: number; firms?: { id: number; name: string }[]; count: number }) {
  const isInvoice = type === 'invoice';
  const label = isInvoice ? 'invoyslar' : type === 'oferta' ? 'ofertalar' : 'arizalar';
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<GenItem[] | null>(null);
  const [total, setTotal] = useState(count);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [q, setQ] = useState('');
  const [flt, setFlt] = useState<'made' | 'notmade' | 'all'>('made'); // chiqarilgan/chiqarilmagan/hammasi
  const [fltPaid, setFltPaid] = useState<'all' | 'paid' | 'unpaid'>('all'); // to'lov holati
  const [fltFirm, setFltFirm] = useState<number | ''>(''); // firma bo'yicha (invoice)
  const [flash, setFlash] = useState(false); // «yangilandi» — import/yaratildidan keyin
  const [loading, setLoading] = useState(false);
  const reqRef = useRef(0);
  const fltRef = useRef(flt); useEffect(() => { fltRef.current = flt; }, [flt]);
  const fltPaidRef = useRef(fltPaid); useEffect(() => { fltPaidRef.current = fltPaid; }, [fltPaid]);
  const fltFirmRef = useRef(fltFirm); useEffect(() => { fltFirmRef.current = fltFirm; }, [fltFirm]);

  const params = useCallback((extra: Record<string, string>) => {
    const p = new URLSearchParams({ type, ...extra });
    if (snapshotId != null) p.set('snapshotId', String(snapshotId));
    const ff = fltFirm !== '' ? fltFirm : firmId;
    if (ff != null) p.set('firmId', String(ff));
    if (q.trim()) p.set('q', q.trim());
    if (isInvoice) { p.set('made', flt); if (fltPaid !== 'all') p.set('paid', fltPaid); }
    return p.toString();
  }, [type, snapshotId, firmId, fltFirm, q, isInvoice, flt, fltPaid]);

  const load = useCallback(async (query: string, pg: number) => {
    if (snapshotId == null) return;
    const my = ++reqRef.current;
    setLoading(true);
    const p = new URLSearchParams({ snapshotId: String(snapshotId), type, page: String(pg) });
    const ff = fltFirmRef.current !== '' ? fltFirmRef.current : firmId;
    if (ff != null) p.set('firmId', String(ff));
    if (query.trim()) p.set('q', query.trim());
    if (isInvoice) { p.set('made', fltRef.current); if (fltPaidRef.current !== 'all') p.set('paid', fltPaidRef.current); }
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
  }, [snapshotId, firmId, type, isInvoice]);

  // Scope (snapshot/firma) o'zgarsa — to'liq reset (yopib, filtrlarni tozalab).
  useEffect(() => { setOpen(false); setItems(null); setQ(''); setPage(1); setFlt('made'); setFltPaid('all'); setFltFirm(''); setTotal(count); }, [snapshotId, firmId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Son o'zgarsa (import/yaratildi) — AVTO YANGILANADI: ochiq bo'lsa joyida qayta yuklaymiz (ustma-ust
  // qolmasin), «yangilandi» belgisi chiqadi. Yopib qo'ymaymiz.
  useEffect(() => {
    setTotal(count);
    if (!open) return;
    load(q, page);
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 2200);
    return () => clearTimeout(t);
  }, [count]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open && items === null) load('', 1); }, [open, items, load]);
  // Qidiruv — debounce, 1-sahifadan.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => load(q, 1), 250);
    return () => clearTimeout(t);
  }, [q, open, load]);
  // Filtrlar (chiqarilgan/to'lov/firma) o'zgarsa — darhol 1-sahifadan qayta yuklaymiz. items'ni null
  // qilMAYMIZ: aks holda yuqoridagi «open && items===null» effekt qidiruvsiz load'ni ustidan yuborardi.
  useEffect(() => { if (open) load(q, 1); }, [flt, fltPaid, fltFirm]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (pg: number) => { if (pg >= 1 && pg <= pages) load(q, pg); };
  const dlUrl = (it: GenItem) => (type === 'invoice' ? `/konveyer/invoice-pdf?caseId=${it.caseId}` : type === 'oferta' ? `/konveyer/gen-oferta?caseId=${it.caseId}` : `/konveyer/gen-ariza?caseId=${it.caseId}`);
  const dlKind = type === 'invoice' ? 'kvitansiya (.pdf)' : type === 'oferta' ? 'oferta (.zip)' : 'ariza (.docx)';
  // Ochilganda sarlavha soni JONLI filtr (firma/to'lov/chiqarilgan) natijasini ko'rsatadi.
  const invSuffix = flt === 'notmade' ? 'chiqarilmagan' : flt === 'all' ? 'jami' : fltPaid === 'paid' ? 'toʻlangan' : fltPaid === 'unpaid' ? 'toʻlanmagan' : 'chiqarilgan';
  const filtered = open && (flt !== 'made' || fltPaid !== 'all' || fltFirm !== '' || q.trim() !== '');

  if (count <= 0 && !isInvoice) return null;

  return (
    <div className="mt-3 rounded-lg border border-line">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className={`flex w-full items-center gap-2 ${open ? 'rounded-t-lg' : 'rounded-lg'} px-3 py-2 text-left transition-colors hover:bg-surface-2`}>
        <Ico.check size={14} className="text-emerald-600 dark:text-emerald-400" />
        <span className="text-xs font-semibold">{isInvoice ? 'Invoyslar' : `Yaratilgan ${label}`}</span>
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${filtered ? 'bg-brand-500/10 text-brand-700 dark:text-brand-300' : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'}`}
          title={filtered ? 'Filtr boʻyicha natija soni' : undefined}>
          {isInvoice ? `${n(filtered ? total : count)} ${filtered ? invSuffix : 'chiqarilgan'}` : n(count)}
        </span>
        {flash && <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">✓ yangilandi</span>}
        <span className="ml-auto text-[11px] text-muted">{open ? 'Yopish' : 'Koʻrish'}</span>
        <Ico.chevron size={14} className={`text-muted transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>

      {open && (
        <div className="border-t border-line">
          {isInvoice && (
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-1.5">
              <div className="flex items-center gap-1">
                {INV_FILTERS.map(([v, l]) => (
                  <button key={v} type="button" onClick={() => setFlt(v)} aria-pressed={flt === v}
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${flt === v ? 'bg-brand-500/10 text-brand-700 dark:text-brand-300' : 'text-muted hover:bg-surface-2'}`}>{l}</button>
                ))}
              </div>
              <div className="ml-auto flex items-center gap-1.5">
                {firms && firms.length > 0 && (
                  <Select className="w-40" searchAfter={6} label="Firma" value={fltFirm !== '' ? String(fltFirm) : ''}
                    options={[{ value: '', label: 'Barcha firma' }, ...firms.map((f) => ({ value: String(f.id), label: f.name }))]}
                    onChange={(v) => setFltFirm(v ? Number(v) : '')} />
                )}
                <Select className="w-36" searchAfter={99} label="Toʻlov holati" value={fltPaid}
                  options={[{ value: 'all', label: 'Barcha toʻlov' }, { value: 'paid', label: 'Toʻlangan' }, { value: 'unpaid', label: 'Toʻlanmagan' }]}
                  onChange={(v) => setFltPaid(v as 'all' | 'paid' | 'unpaid')} />
              </div>
            </div>
          )}
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
                    {type === 'invoice' && it.status && (
                      <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${STATUS[it.status].cls}`}>{STATUS[it.status].label}</span>
                    )}
                    {it.courtName && <span className="hidden shrink-0 rounded-full border border-line px-1.5 py-0.5 text-[10px] text-muted sm:inline">{it.courtName}</span>}
                    <span className="hidden shrink-0 text-[11px] tabular-nums text-muted sm:inline">{fmtWhen(it.at)}</span>
                    {isInvoice && it.status === 'notmade' ? (
                      <span className="grid h-6 w-6 shrink-0 place-items-center text-[11px] text-muted/50" title="Invoice hali chiqarilmagan">—</span>
                    ) : (
                      <a href={dlUrl(it)} title={`${it.clientName || 'mijoz'} — ${dlKind} yuklab olish`}
                        className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-brand-500/10 hover:text-brand-600 dark:hover:text-brand-400">
                        <Ico.download size={13} />
                      </a>
                    )}
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
