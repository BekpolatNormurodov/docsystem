'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Ico, Spinner, Modal, useConfirm } from '@/ui';
import { FIRMS, type FirmCfg } from '@/lib/firms';

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

interface CheckedInvoice {
  id: number;
  number: string;
  invoiceStatus: string;
  amount: string | number | null;
  paidAmount: string | number | null;
  mustPayAmount: string | number | null;
  balance: string | number | null;
  payer: string | null;
  payerTin: string | null;
  firmCode: string | null;
  court: string | null;
  forAccount: string | null;
  description: string | null;
  payCategory: string | null;
  claimCaseNumber: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  source: 'SINGLE' | 'LIST';
  checkedAt: string;
}

interface SearchPage {
  content: CheckedInvoice[];
  pageNumber: number;
  pageSize: number;
  totalElements: number;
  totalPages: number;
  last: boolean;
}

interface QueryRow {
  id: number;
  createdAt: string;
  createdBy: string | null;
  mode: 'SINGLE' | 'LIST';
  query: string;
  page: number | null;
  resultCount: number;
  status: string;
  message: string | null;
}

const STATUSES = ['CREATED', 'PAID', 'USED'] as const;
const STATUS_LABEL: Record<string, string> = {
  CREATED: "To'lanmagan",
  PAID: "To'liq to'langan",
  USED: 'Foydalanilgan',
};
const STATUS_STYLE: Record<string, string> = {
  CREATED: 'border-rose-500/30 text-rose-600 dark:text-rose-300',
  PAID: 'border-emerald-500/30 text-emerald-600 dark:text-emerald-300',
  USED: 'border-amber-500/30 text-amber-600 dark:text-amber-300',
};

const money = (v: string | number | null) => {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('ru-RU') : String(v);
};
const val = (v: string | null) => (v && v.trim() ? v : '—');
const dt = (s: string | null) =>
  s ? new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

async function jpost(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

const firmLabel = (code: string | null) => FIRMS.find((f: FirmCfg) => f.branchCode === code)?.name?.replace(/ MIKROMOLIYA.*$/i, '');

export function InvoiceCheck() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">Invoice tekshiruvi</h1>
          <span className="badge border-brand-500/30 text-brand-600 dark:text-brand-400">Alohida · stepga kirmaydi</span>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          billing.sud.uz dan kvitansiya holatini tekshiring: bitta raqam bo'yicha yoki firma STIR bo'yicha
          ro'yxat (sahifalab). Tekshirilgan har bir kvitansiya pastdagi keshga va tarixga saqlanadi.
        </p>
      </header>

      <SingleCheckCard />
      <ListCheckCard />
      <CachedCard />
      <HistoryCard />
    </div>
  );
}

// ── 1) Bitta kvitansiya ──────────────────────────────────────────────────────
function SingleCheckCard() {
  const [num, setNum] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [inv, setInv] = useState<CheckedInvoice | null>(null);

  const run = useCallback(async () => {
    const n = num.trim();
    if (!n) return;
    setLoading(true);
    setErr(null);
    const { ok, json } = await jpost('/api/billing-check/single', { invoice: n });
    setLoading(false);
    if (!ok) { setErr(json?.error || 'Xato'); return; }
    setInv(json.invoice);
  }, [num]);

  return (
    <section className="card space-y-4 p-5">
      <h2 className="text-sm font-semibold">Bitta kvitansiya</h2>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={num}
          onChange={(e) => setNum(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void run(); }}
          placeholder="Kvitansiya raqami (masalan 261255354462)"
          className="field-input w-72"
        />
        <button onClick={() => void run()} disabled={loading || !num.trim()} className="btn-primary">
          {loading ? <Spinner size={14} className="mr-1.5" /> : null}Tekshirish
        </button>
        {inv && (
          <button onClick={() => void run()} disabled={loading} className="btn-ghost">
            <Ico.refresh size={14} className="mr-1 inline" />Yangilash
          </button>
        )}
      </div>
      {err && <div className="text-sm text-rose-600 dark:text-rose-300">{err}</div>}
      {inv && <InvoiceDetail inv={inv} />}
    </section>
  );
}

function InvoiceDetail({ inv }: { inv: CheckedInvoice }) {
  return (
    <div className="rounded-xl border border-line p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold">{inv.number}</span>
        <span className={cx('badge', STATUS_STYLE[inv.invoiceStatus] ?? 'border-line text-muted')}>
          {STATUS_LABEL[inv.invoiceStatus] ?? inv.invoiceStatus}
        </span>
        {inv.firmCode && <span className="badge border-brand-500/30 text-brand-600 dark:text-brand-400">{firmLabel(inv.firmCode) || 'bizning firma'}</span>}
      </div>
      <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        <DRow l="Egasi" v={val(inv.payer)} />
        <DRow l="STIR/pasport" v={val(inv.payerTin)} />
        <DRow l="Sud" v={val(inv.court)} />
        <DRow l="Shaxsiy hisob raqami" v={val(inv.forAccount)} />
        <DRow l="Qo'shimcha ma'lumot" v={val(inv.description)} />
        <DRow l="Da'vo raqami" v={val(inv.claimCaseNumber)} />
        <DRow l="Kvitansiya summasi" v={money(inv.amount)} strong />
        <DRow l="To'lanmagan summa" v={money(inv.mustPayAmount)} />
        <DRow l="Sarflangan/to'langan" v={money(inv.paidAmount)} />
        <DRow l="Qoldiq" v={money(inv.balance)} />
        <DRow l="Yaratilgan" v={dt(inv.issuedAt)} />
        <DRow l="Amal qilish muddati" v={dt(inv.expiresAt)} />
        <DRow l="Oxirgi tekshirilgan" v={dt(inv.checkedAt)} />
      </dl>
    </div>
  );
}

function DRow({ l, v, strong }: { l: string; v: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3 border-b border-line/50 py-1">
      <span className="text-muted">{l}</span>
      <span className={cx('text-right tabular-nums', strong && 'font-semibold')}>{v}</span>
    </div>
  );
}

function DetailModal({ inv, onClose }: { inv: CheckedInvoice | null; onClose: () => void }) {
  return (
    <Modal open={!!inv} onClose={onClose} title={inv ? `Kvitansiya ${inv.number}` : ''} size="lg">
      {inv && <InvoiceDetail inv={inv} />}
    </Modal>
  );
}

// ── 2) STIR bo'yicha ro'yxat (billing.sud.uz dan jonli) ─────────────────────
const PAGE_SIZE = 10;

function ListCheckCard() {
  const [stir, setStir] = useState<string>(FIRMS[0]?.stir ?? '');
  const [customStir, setCustomStir] = useState('');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<SearchPage | null>(null);
  const [detail, setDetail] = useState<CheckedInvoice | null>(null);

  const activeStir = customStir.trim() || stir;

  const run = useCallback(async (p: number) => {
    if (!activeStir) return;
    setLoading(true);
    setErr(null);
    const { ok, json } = await jpost('/api/billing-check/list', { inn: activeStir, page: p, size: PAGE_SIZE });
    setLoading(false);
    if (!ok) { setErr(json?.error || 'Xato'); return; }
    setResult(json);
    setPage(p);
  }, [activeStir]);

  return (
    <section className="card space-y-4 p-5">
      <h2 className="text-sm font-semibold">Ro'yxat — STIR bo'yicha (billing.sud.uz, jonli)</h2>
      <div className="flex flex-wrap items-center gap-2">
        {FIRMS.map((f) => (
          <Chip key={f.branchCode} active={!customStir && stir === f.stir} onClick={() => { setCustomStir(''); setStir(f.stir); }}>
            {f.name.replace(/ MIKROMOLIYA.*$/i, '')}
          </Chip>
        ))}
        <input
          value={customStir}
          onChange={(e) => setCustomStir(e.target.value)}
          placeholder="Boshqa STIR"
          className="field-input w-40"
        />
        <button onClick={() => void run(0)} disabled={loading || !activeStir} className="btn-primary">
          {loading ? <Spinner size={14} className="mr-1.5" /> : null}Qidirish
        </button>
        {result && (
          <button onClick={() => void run(page)} disabled={loading} className="btn-ghost">
            <Ico.refresh size={14} className="mr-1 inline" />Yangilash
          </button>
        )}
      </div>
      {err && <div className="text-sm text-rose-600 dark:text-rose-300">{err}</div>}

      {result && (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-left text-xs text-muted">
                <tr>
                  <th className="px-3 py-2">Kvitansiya raqami</th>
                  <th className="px-3 py-2">Holati</th>
                  <th className="px-3 py-2">Summasi</th>
                  <th className="px-3 py-2">Yaratilgan</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {result.content.map((row) => (
                  <tr key={row.id} className="cursor-pointer border-t border-line/60 hover:bg-surface-2/50" onClick={() => setDetail(row)}>
                    <td className="px-3 py-2 font-mono">{row.number}</td>
                    <td className="px-3 py-2">
                      <span className={cx('badge', STATUS_STYLE[row.invoiceStatus] ?? 'border-line text-muted')}>
                        {STATUS_LABEL[row.invoiceStatus] ?? row.invoiceStatus}
                      </span>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{money(row.amount)}</td>
                    <td className="px-3 py-2">{dt(row.issuedAt)}</td>
                    <td className="px-3 py-2 text-right">
                      <button className="btn-ghost !py-1 !px-2" onClick={(e) => { e.stopPropagation(); setDetail(row); }}>Batafsil</button>
                    </td>
                  </tr>
                ))}
                {!result.content.length && (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-muted">Natija yo'q</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
            <span>
              {result.totalElements ? `${result.pageNumber * result.pageSize + 1} - ${Math.min((result.pageNumber + 1) * result.pageSize, result.totalElements)} dan ${result.totalElements}` : '0 dan 0'}
              {result.content[0]?.firmCode && firmLabel(result.content[0].firmCode) ? ` · ${firmLabel(result.content[0].firmCode)}` : ''}
            </span>
            <div className="flex items-center gap-2">
              <button className="btn-ghost !py-1 !px-2" disabled={loading || page <= 0} onClick={() => void run(page - 1)}>
                <Ico.chevronLeft size={16} />
              </button>
              <span className="tabular-nums">{page + 1} / {result.totalPages || 1}</span>
              <button className="btn-ghost !py-1 !px-2" disabled={loading || result.last} onClick={() => void run(page + 1)}>
                <Ico.chevron size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
      <DetailModal inv={detail} onClose={() => setDetail(null)} />
    </section>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
        active ? 'border-brand-500 bg-brand-500/10 text-brand-700 dark:text-brand-300' : 'border-line text-muted hover:bg-surface-2 hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}

// ── 3) Kesh — to'plangan kvitansiyalar (bizning DB, filtrlab, Excel) ─────────
function CachedCard() {
  const [firmCode, setFirmCode] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [rows, setRows] = useState<CheckedInvoice[]>([]);
  const [summary, setSummary] = useState<{ firmCode: string | null; _count: { _all: number } }[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<CheckedInvoice | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (firmCode) params.set('firm', firmCode);
    if (status) params.set('status', status);
    const res = await fetch(`/api/billing-check?${params.toString()}`, { cache: 'no-store' });
    const j = await res.json().catch(() => ({ invoices: [], summary: [] }));
    setRows(j.invoices ?? []);
    setSummary(j.summary ?? []);
    setLoading(false);
  }, [firmCode, status]);

  useEffect(() => { void refresh(); }, [refresh]);

  const countFor = (code: string | null) => summary.find((s) => s.firmCode === code)?._count?._all ?? 0;
  const total = summary.reduce((s, r) => s + r._count._all, 0);

  const excelHref = (() => {
    const params = new URLSearchParams();
    if (firmCode) params.set('firm', firmCode);
    if (status) params.set('status', status);
    return `/api/billing-check/excel?${params.toString()}`;
  })();

  return (
    <section className="card space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">To'plangan kvitansiyalar (kesh)</h2>
        <a href={excelHref} className="btn-ghost">
          <Ico.download size={14} className="mr-1 inline" />Excel yuklab olish
        </a>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Chip active={firmCode === null} onClick={() => setFirmCode(null)}>Barchasi ({total})</Chip>
        {FIRMS.map((f) => (
          <Chip key={f.branchCode} active={firmCode === f.branchCode} onClick={() => setFirmCode(f.branchCode)}>
            {f.name.replace(/ MIKROMOLIYA.*$/i, '')} ({countFor(f.branchCode)})
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Chip active={status === null} onClick={() => setStatus(null)}>Barcha holat</Chip>
        {STATUSES.map((s) => (
          <Chip key={s} active={status === s} onClick={() => setStatus(s)}>{STATUS_LABEL[s]}</Chip>
        ))}
      </div>

      {loading ? (
        <div className="text-sm text-muted"><Spinner size={14} className="mr-1.5 inline" />Yuklanmoqda…</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-2">Kvitansiya raqami</th>
                <th className="px-3 py-2">Holati</th>
                <th className="px-3 py-2">Firma/Egasi</th>
                <th className="px-3 py-2">Summasi</th>
                <th className="px-3 py-2">Tekshirilgan</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="cursor-pointer border-t border-line/60 hover:bg-surface-2/50" onClick={() => setDetail(row)}>
                  <td className="px-3 py-2 font-mono">{row.number}</td>
                  <td className="px-3 py-2">
                    <span className={cx('badge', STATUS_STYLE[row.invoiceStatus] ?? 'border-line text-muted')}>
                      {STATUS_LABEL[row.invoiceStatus] ?? row.invoiceStatus}
                    </span>
                  </td>
                  <td className="px-3 py-2">{firmLabel(row.firmCode) || val(row.payer)}</td>
                  <td className="px-3 py-2 tabular-nums">{money(row.amount)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{dt(row.checkedAt)}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-muted">Hali kvitansiya tekshirilmagan</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <DetailModal inv={detail} onClose={() => setDetail(null)} />
    </section>
  );
}

// ── 4) Tarix ──────────────────────────────────────────────────────────────────
function HistoryCard() {
  const confirm = useConfirm();
  const [rows, setRows] = useState<QueryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch('/api/billing-check', { cache: 'no-store' });
    const j = await res.json().catch(() => ({ queries: [] }));
    setRows(j.queries ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const del = async (r: QueryRow) => {
    const ok = await confirm({
      title: 'Tarix yozuvini o‘chirish',
      description: `«${r.query}» qidiruvi tarixdan butunlay o‘chiriladi. Davom etilsinmi?`,
      confirmLabel: 'O‘chirish', danger: true,
    });
    if (!ok) return;
    await fetch(`/api/billing-check/query/${r.id}`, { method: 'DELETE' });
    await refresh();
  };

  return (
    <section className="card p-5">
      <button className="flex w-full items-center justify-between text-left" onClick={() => setOpen((o) => !o)}>
        <h2 className="text-sm font-semibold">Tarix ({rows.length})</h2>
        <Ico.chevron size={16} className={cx('transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        loading ? (
          <div className="mt-3 text-sm text-muted"><Spinner size={14} className="mr-1.5 inline" />Yuklanmoqda…</div>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-left text-xs text-muted">
                <tr>
                  <th className="px-3 py-2">Vaqt</th>
                  <th className="px-3 py-2">Kim</th>
                  <th className="px-3 py-2">Turi</th>
                  <th className="px-3 py-2">Qidiruv</th>
                  <th className="px-3 py-2">Natija</th>
                  <th className="px-3 py-2">Holat</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-line/60">
                    <td className="px-3 py-2 whitespace-nowrap">{dt(r.createdAt)}</td>
                    <td className="px-3 py-2">{r.createdBy || '—'}</td>
                    <td className="px-3 py-2">{r.mode === 'SINGLE' ? 'Bitta' : `Ro'yxat${r.page !== null ? ` (bet ${(r.page ?? 0) + 1})` : ''}`}</td>
                    <td className="px-3 py-2 font-mono">{r.query}</td>
                    <td className="px-3 py-2 tabular-nums">{r.resultCount}</td>
                    <td className="px-3 py-2">
                      {r.status === 'OK'
                        ? <span className="badge border-emerald-500/30 text-emerald-600 dark:text-emerald-300">OK</span>
                        : <span className="badge border-rose-500/30 text-rose-600 dark:text-rose-300" title={r.message || ''}>Xato</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button className="btn-ghost !py-1 !px-2" onClick={() => void del(r)}>
                        <Ico.trash size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={7} className="px-3 py-6 text-center text-muted">Hali qidiruv bo'lmagan</td></tr>}
              </tbody>
            </table>
          </div>
        )
      )}
    </section>
  );
}
