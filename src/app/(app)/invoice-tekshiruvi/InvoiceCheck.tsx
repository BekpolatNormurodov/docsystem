'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Ico, Spinner, Modal, Select, useConfirm } from '@/ui';
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

interface SyncState {
  firmCode: string;
  firmName: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  done: number;
  total: number;
  lastCount: number;
  trigger: string | null;
  message: string | null;
}

interface StatRow { invoiceStatus: string; _count: { _all: number }; _sum: { amount: string | number | null } }

const STATUSES = ['PAID', 'CREATED', 'USED'] as const;
const STATUS_LABEL: Record<string, string> = {
  CREATED: "To'lanmagan",
  PAID: "To'langan (ishlatilmagan)",
  USED: 'Foydalanilgan',
};
// Jadvalda qisqa yorliq — uzuni qatorlarni ikki qatorga cho'zib yuboradi. Rang farqlaydi,
// to'liq matni esa `title` da va statistika kartochkalarida turadi.
const STATUS_SHORT: Record<string, string> = { CREATED: "To'lanmagan", PAID: "To'langan", USED: 'Foydalanilgan' };
const STATUS_STYLE: Record<string, string> = {
  CREATED: 'border-rose-500/30 text-rose-600 dark:text-rose-300',
  PAID: 'border-emerald-500/30 text-emerald-600 dark:text-emerald-300',
  USED: 'border-amber-500/30 text-amber-600 dark:text-amber-300',
};

const SIZES = [10, 20, 50] as const;

// «Hozir yangilash» nechta kvitansiyani tortsin. 0 = butun ro'yxat.
const SYNC_LIMITS = [
  { value: '0', label: 'Hammasi' },
  { value: '5', label: 'Oxirgi 5 ta' },
  { value: '10', label: 'Oxirgi 10 ta' },
  { value: '50', label: 'Oxirgi 50 ta' },
  { value: '100', label: 'Oxirgi 100 ta' },
];

// DIQQAT: billing.sud.uz summalarni TIYINDA qaytaradi — 2 060 000 = 20 600,00 so'm
// (billing.sud.uz sahifasining o'zi ham shunday ko'rsatadi). Bazada xom ko'rinishda
// saqlanadi, so'mga aylantirish faqat ko'rsatishda (bu yerda va Excel eksportida).
const TIYIN = 100;
const money = (v: string | number | null) => {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return Number.isFinite(n) ? (n / TIYIN).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v);
};
const val = (v: string | null) => (v && v.trim() ? v : '—');
const dt = (s: string | null) =>
  s ? new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const firmLabel = (code: string | null) => FIRMS.find((f: FirmCfg) => f.branchCode === code)?.name?.replace(/ MIKROMOLIYA.*$/i, '');

async function jpost(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

export function InvoiceCheck() {
  const [tick, setTick] = useState(0);
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">Invoice tekshiruvi</h1>
          <span className="badge border-brand-500/30 text-brand-600 dark:text-brand-400">Alohida · stepga kirmaydi</span>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Kvitansiyalar firma bo'yicha bazaga yig'iladi va <b>har yarim soatda o'zi yangilanadi</b>.
          Qidiruv, filtr va Excel — shu bazadan.
        </p>
      </header>

      <SingleCheckCard onSaved={() => setTick((t) => t + 1)} />
      <CacheCard tick={tick} onChanged={() => setTick((t) => t + 1)} />
      <HistoryCard tick={tick} />
    </div>
  );
}

// ── 1) Bitta kvitansiya ──────────────────────────────────────────────────────
function SingleCheckCard({ onSaved }: { onSaved: () => void }) {
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
    onSaved();
  }, [num, onSaved]);

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
        {inv.firmCode && <span className="badge border-brand-500/30 text-brand-600 dark:text-brand-400">{firmLabel(inv.firmCode)}</span>}
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

// ── 2) Baza: avtomatik yangilanadi + qidiruv/sahifalash ─────────────────────
function CacheCard({ tick, onChanged }: { tick: number; onChanged: () => void }) {
  const [firmCode, setFirmCode] = useState<string | null>(FIRMS[0]?.branchCode ?? null);
  const [status, setStatus] = useState<string | null>(null);
  // To'lov turi (payCategory) va summa (tiyinda) — ikkalasi ham '' = barchasi.
  const [cat, setCat] = useState('');
  const [amount, setAmount] = useState('');
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [page, setPage] = useState(0);
  const [size, setSize] = useState<number>(20);

  const [rows, setRows] = useState<CheckedInvoice[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<{ firmCode: string | null; _count: { _all: number } }[]>([]);
  const [stats, setStats] = useState<StatRow[]>([]);
  const [catFacet, setCatFacet] = useState<{ payCategory: string | null; _count: { _all: number } }[]>([]);
  const [amountFacet, setAmountFacet] = useState<{ amount: string | number | null; _count: { _all: number } }[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<CheckedInvoice | null>(null);

  const [syncStates, setSyncStates] = useState<SyncState[]>([]);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // 0 = hammasi; aks holda «oxirgi N ta» (yangi kvitansiyalarni tez ilib olish uchun).
  const [syncLimit, setSyncLimit] = useState(0);
  const wasRunning = useRef(false);

  // Qidiruv: 250ms kechikish (har harfda so'rov yubormaslik uchun), Enter — darhol.
  useEffect(() => {
    const t = setTimeout(() => { setDq(q.trim()); setPage(0); }, 250);
    return () => clearTimeout(t);
  }, [q]);

  // Barcha filtrlar bitta joyda — ro'yxat so'rovi ham, Excel havolasi ham shundan quriladi.
  const filterParams = useCallback(() => {
    const p = new URLSearchParams();
    if (firmCode) p.set('firm', firmCode);
    if (status) p.set('status', status);
    if (cat) p.set('cat', cat);
    if (amount) p.set('amount', amount);
    if (dq) p.set('q', dq);
    return p;
  }, [firmCode, status, cat, amount, dq]);

  const load = useCallback(async () => {
    setLoading(true);
    const params = filterParams();
    params.set('page', String(page));
    params.set('size', String(size));
    const res = await fetch(`/api/billing-check?${params.toString()}`, { cache: 'no-store' });
    if (!res.ok) { setErr('Ro‘yxatni yuklab bo‘lmadi'); setLoading(false); return; }
    const j = await res.json().catch(() => null);
    if (!j) { setErr('Ro‘yxatni yuklab bo‘lmadi'); setLoading(false); return; }
    setErr(null);
    setRows(j.invoices ?? []);
    setTotal(j.total ?? 0);
    setSummary(j.summary ?? []);
    setStats(j.stats ?? []);
    setCatFacet(j.catFacet ?? []);
    setAmountFacet(j.amountFacet ?? []);
    setLoading(false);
  }, [filterParams, page, size]);

  useEffect(() => { void load(); }, [load, tick]);

  // Yig'ish holatini kuzatish: ketayotganda tez-tez, bo'sh turganda siyrak (avtomatik
  // yangilanish worker'da bo'lgani uchun uni ham shu yerdan ushlab olamiz).
  const pollSync = useCallback(async () => {
    const res = await fetch('/api/billing-check/sync', { cache: 'no-store' });
    if (!res.ok) return;
    const j = await res.json().catch(() => null);
    if (!j) return;
    setSyncStates(j.states ?? []);
    setRunning(!!j.running);
    // Yig'ish endigina tugadi → jadvalni va sonlarni yangilaymiz.
    if (wasRunning.current && !j.running) onChanged();
    wasRunning.current = !!j.running;
  }, [onChanged]);

  useEffect(() => {
    void pollSync();
    const t = setInterval(() => void pollSync(), running ? 2000 : 20000);
    return () => clearInterval(t);
  }, [pollSync, running]);

  const activeFirm = FIRMS.find((f: FirmCfg) => f.branchCode === firmCode);
  const activeSync = syncStates.find((s) => s.firmCode === firmCode);
  const runningSync = syncStates.find((s) => s.status === 'RUNNING');
  const countFor = (code: string | null) => summary.find((s) => s.firmCode === code)?._count?._all ?? 0;
  const cachedTotal = summary.reduce((s, r) => s + r._count._all, 0);
  const statFor = (st: string) => stats.find((s) => s.invoiceStatus === st);

  const startSync = useCallback(async () => {
    if (!activeFirm) return;
    setErr(null);
    const { ok, json } = await jpost('/api/billing-check/sync', {
      firm: activeFirm.branchCode,
      ...(syncLimit ? { limit: syncLimit } : {}),
    });
    if (!ok) { setErr(json?.error || 'Boshlab bo‘lmadi'); return; }
    setRunning(true);
    wasRunning.current = true;
    void pollSync();
  }, [activeFirm, pollSync, syncLimit]);

  const excelHref = `/api/billing-check/excel?${filterParams().toString()}`;

  // Tanlanadigan turlar/summalar — bazada bori (ko'pdan ozga).
  const catOptions = [
    { value: '', label: 'Barcha turi' },
    ...catFacet
      .filter((c) => c.payCategory)
      .sort((a, b) => b._count._all - a._count._all)
      .map((c) => ({ value: c.payCategory as string, label: `${c.payCategory} (${c._count._all})` })),
  ];
  const amountOptions = [
    { value: '', label: 'Barcha summa' },
    ...amountFacet
      .filter((a) => a.amount !== null)
      .sort((a, b) => Number(b._count._all) - Number(a._count._all))
      .map((a) => ({ value: String(a.amount), label: `${money(a.amount)} so‘m (${a._count._all})` })),
  ];

  const lastPage = Math.max(0, Math.ceil(total / size) - 1);

  return (
    <section className="card space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Kvitansiyalar bazasi</h2>
        <a href={excelHref} className="btn-ghost" title="Har firma alohida varaqda + xulosa">
          <Ico.download size={14} className="mr-1 inline" />Excel yuklab olish
        </a>
      </div>

      {/* firma tanlash */}
      <div className="flex flex-wrap items-center gap-2">
        {FIRMS.map((f: FirmCfg) => (
          <Chip key={f.branchCode} active={firmCode === f.branchCode} onClick={() => { setFirmCode(f.branchCode); setPage(0); }}>
            {f.name.replace(/ MIKROMOLIYA.*$/i, '')} <span className="opacity-60">({countFor(f.branchCode)})</span>
          </Chip>
        ))}
        <Chip active={firmCode === null} onClick={() => { setFirmCode(null); setPage(0); }}>Barchasi ({cachedTotal})</Chip>
      </div>

      {/* yig'ish holati — avtomatik, qo'lda ham majburlash mumkin */}
      <div className="rounded-xl border border-line bg-surface-2/40 p-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {running ? (
            <>
              <Spinner size={14} />
              <span className="text-sm">
                <b>{runningSync?.firmName ?? '—'}</b> yig‘ilmoqda
                <span className="ml-2 tabular-nums text-muted">
                  {runningSync?.done ?? 0}{runningSync?.total ? ` / ${runningSync.total}` : ''}
                </span>
                {runningSync?.trigger === 'AUTO' && <span className="ml-2 text-muted">· avtomatik</span>}
              </span>
              <span className="text-sm text-amber-600 dark:text-amber-300">— tugagunicha yangi yangilash boshlanmaydi</span>
            </>
          ) : (
            <>
              <span className="text-sm text-muted">
                {activeFirm ? <><b>{activeFirm.name.replace(/ MIKROMOLIYA.*$/i, '')}</b> · oxirgi yangilangan: </> : 'Firmani tanlang · '}
                <span className="text-fg">{dt(activeSync?.finishedAt ?? null)}</span>
                {activeSync?.lastCount ? <span className="tabular-nums"> ({activeSync.lastCount} ta)</span> : null}
              </span>
              <span className="text-sm text-muted">· har 30 daqiqada avtomatik</span>
              <div className="ml-auto flex items-center gap-2">
                <Select
                  value={String(syncLimit)}
                  onChange={(v) => setSyncLimit(Number(v))}
                  options={SYNC_LIMITS}
                  className="w-40"
                />
                <button onClick={() => void startSync()} disabled={!activeFirm} className="btn-primary">
                  <Ico.refresh size={14} className="mr-1.5 inline" />Hozir yangilash
                </button>
              </div>
            </>
          )}
        </div>
        {activeSync?.status === 'FAILED' && activeSync.message && (
          <div className="mt-2 text-sm text-rose-600 dark:text-rose-300">Oxirgi urinish uzildi: {activeSync.message}</div>
        )}
      </div>
      {err && <div className="text-sm text-rose-600 dark:text-rose-300">{err}</div>}

      {/* statistika — «to'langan, ishlatilmagan» eng muhimi */}
      <div className="grid gap-3 sm:grid-cols-3">
        {STATUSES.map((st) => {
          const s = statFor(st);
          return (
            <div key={st} className={cx('rounded-xl border p-3', st === 'PAID' ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-line')}>
              <div className={cx('text-lg font-semibold tabular-nums', st === 'PAID' && 'text-emerald-600 dark:text-emerald-300')}>
                {(s?._count?._all ?? 0).toLocaleString('ru-RU')} ta
              </div>
              <div className="mt-0.5 text-sm tabular-nums text-muted">{money(s?._sum?.amount ?? 0)} so‘m</div>
              <div className="mt-1 text-xs text-muted">{STATUS_LABEL[st]}</div>
            </div>
          );
        })}
      </div>

      {/* qidiruv + holat + sahifa o'lchami */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { setDq(q.trim()); setPage(0); } if (e.key === 'Escape') setQ(''); }}
            placeholder="Qidirish: raqam, egasi, STIR, da'vo…"
            className="field-input w-72 pr-8"
          />
          {q && (
            <button onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-fg" title="Tozalash">
              <Ico.close size={16} />
            </button>
          )}
        </div>
        <Chip active={status === null} onClick={() => { setStatus(null); setPage(0); }}>Barcha holat</Chip>
        {STATUSES.map((s) => (
          <Chip key={s} active={status === s} onClick={() => { setStatus(s); setPage(0); }}>{STATUS_LABEL[s]}</Chip>
        ))}
      </div>

      {/* to'lov turi + summa bo'yicha filtr (Почта харажатлари / боji va h.k.) */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={cat} onChange={(v) => { setCat(v); setPage(0); }} options={catOptions} className="w-64" />
        <Select value={amount} onChange={(v) => { setAmount(v); setPage(0); }} options={amountOptions} className="w-56" />
        {(cat || amount || status || dq) && (
          <button
            className="btn-ghost !py-1.5 !px-3 text-sm"
            onClick={() => { setCat(''); setAmount(''); setStatus(null); setQ(''); setPage(0); }}
          >
            <Ico.close size={14} className="mr-1 inline" />Filtrni tozalash
          </button>
        )}
        <div className="ml-auto flex items-center gap-1 text-sm text-muted">
          <span>Sahifada:</span>
          {SIZES.map((n) => (
            <button
              key={n}
              onClick={() => { setSize(n); setPage(0); }}
              className={cx('rounded-lg border px-2 py-1 tabular-nums transition-colors',
                size === n ? 'border-brand-500 bg-brand-500/10 text-brand-700 dark:text-brand-300' : 'border-line hover:bg-surface-2 hover:text-fg')}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* jadval */}
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-xs text-muted">
            <tr>
              <th className="px-3 py-2">Kvitansiya raqami</th>
              <th className="px-3 py-2">Holati</th>
              <th className="px-3 py-2">Turi</th>
              <th className="px-3 py-2">Summasi</th>
              <th className="px-3 py-2">Da'vo raqami</th>
              <th className="px-3 py-2">Yaratilgan</th>
              <th className="px-3 py-2">Tekshirilgan</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-muted"><Spinner size={16} className="mr-2 inline" />Yuklanmoqda…</td></tr>
            ) : rows.length ? (
              rows.map((row) => (
                <tr key={row.id} className="cursor-pointer border-t border-line/60 hover:bg-surface-2/50" onClick={() => setDetail(row)}>
                  <td className="px-3 py-2 font-mono">{row.number}</td>
                  <td className="px-3 py-2">
                    <span
                      className={cx('badge whitespace-nowrap', STATUS_STYLE[row.invoiceStatus] ?? 'border-line text-muted')}
                      title={STATUS_LABEL[row.invoiceStatus] ?? row.invoiceStatus}
                    >
                      {STATUS_SHORT[row.invoiceStatus] ?? row.invoiceStatus}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted">{val(row.payCategory ?? row.description)}</td>
                  <td className="px-3 py-2 tabular-nums">{money(row.amount)}</td>
                  <td className="px-3 py-2">{val(row.claimCaseNumber)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{dt(row.issuedAt)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted">{dt(row.checkedAt)}</td>
                </tr>
              ))
            ) : (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-muted">
                {dq || status ? 'Filtrga mos yozuv yo‘q' : 'Bazada hali kvitansiya yo‘q — «Hozir yangilash» ni bosing'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* sahifalash */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
        <span className="tabular-nums">
          {total ? `${page * size + 1} – ${Math.min((page + 1) * size, total)} / ${total}` : '0'}
        </span>
        <div className="flex items-center gap-1">
          <button className="btn-ghost !py-1 !px-2" disabled={loading || page <= 0} onClick={() => setPage(0)} title="Boshiga">«</button>
          <button className="btn-ghost !py-1 !px-2" disabled={loading || page <= 0} onClick={() => setPage((p) => p - 1)}>
            <Ico.chevronLeft size={16} />
          </button>
          <span className="px-2 tabular-nums">{page + 1} / {lastPage + 1}</span>
          <button className="btn-ghost !py-1 !px-2" disabled={loading || page >= lastPage} onClick={() => setPage((p) => p + 1)}>
            <Ico.chevron size={16} />
          </button>
          <button className="btn-ghost !py-1 !px-2" disabled={loading || page >= lastPage} onClick={() => setPage(lastPage)} title="Oxiriga">»</button>
        </div>
      </div>

      <DetailModal inv={detail} onClose={() => setDetail(null)} />
    </section>
  );
}

function Chip({ active, onClick, children, disabled }: { active: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40',
        active ? 'border-brand-500 bg-brand-500/10 text-brand-700 dark:text-brand-300' : 'border-line text-muted hover:bg-surface-2 hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}

// ── 3) Tarix ──────────────────────────────────────────────────────────────────
function HistoryCard({ tick }: { tick: number }) {
  const confirm = useConfirm();
  const [rows, setRows] = useState<QueryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch('/api/billing-check/history', { cache: 'no-store' });
    const j = await res.json().catch(() => ({ queries: [] }));
    setRows(j.queries ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh, tick]);

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
                    <td className="px-3 py-2">{r.mode === 'SINGLE' ? 'Bitta' : "Ro'yxat"}</td>
                    <td className="px-3 py-2 font-mono">{firmLabel(null) === r.query ? r.query : r.query}</td>
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
