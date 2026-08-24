'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
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

// billing.sud.uz bir so'rovda shuncha qatorni bemalol qaytaradi (Spring Pageable).
const SYNC_PAGE = 50;
const TABLE_SIZE = 20;

const money = (v: string | number | null) => {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('ru-RU') : String(v);
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
  // Yig'ish tugagach kesh jadvali o'zini yangilashi uchun oddiy signal.
  const [syncTick, setSyncTick] = useState(0);
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">Invoice tekshiruvi</h1>
          <span className="badge border-brand-500/30 text-brand-600 dark:text-brand-400">Alohida · stepga kirmaydi</span>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          billing.sud.uz dan kvitansiya holatini tekshiring: bitta raqam bo'yicha yoki firma STIR
          bo'yicha butun ro'yxatni bazaga yig'ib, qidiruv va Excel bilan ishlang.
        </p>
      </header>

      <SingleCheckCard onSaved={() => setSyncTick((t) => t + 1)} />
      <CacheCard syncTick={syncTick} onSynced={() => setSyncTick((t) => t + 1)} />
      <HistoryCard tick={syncTick} />
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

// ── 2) Baza: billing.sud.uz dan yig'ish + qidiruv/sahifalash ─────────────────
function CacheCard({ syncTick, onSynced }: { syncTick: number; onSynced: () => void }) {
  // filtrlar
  const [firmCode, setFirmCode] = useState<string | null>(FIRMS[0]?.branchCode ?? null);
  const [status, setStatus] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [dq, setDq] = useState(''); // debounced qidiruv
  const [page, setPage] = useState(0);

  // ma'lumot
  const [rows, setRows] = useState<CheckedInvoice[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<{ firmCode: string | null; _count: { _all: number } }[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<CheckedInvoice | null>(null);

  // yig'ish (sync)
  const [syncing, setSyncing] = useState(false);
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const cancelRef = useRef(false);

  // Qidiruvni 400ms kechiktiramiz — har harfda so'rov yubormaslik uchun.
  useEffect(() => {
    const t = setTimeout(() => { setDq(q.trim()); setPage(0); }, 400);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), size: String(TABLE_SIZE) });
    if (firmCode) params.set('firm', firmCode);
    if (status) params.set('status', status);
    if (dq) params.set('q', dq);
    const res = await fetch(`/api/billing-check?${params.toString()}`, { cache: 'no-store' });
    const j = await res.json().catch(() => ({ invoices: [], total: 0, summary: [] }));
    setRows(j.invoices ?? []);
    setTotal(j.total ?? 0);
    setSummary(j.summary ?? []);
    setLoading(false);
  }, [firmCode, status, dq, page]);

  useEffect(() => { void load(); }, [load, syncTick]);

  const activeFirm = FIRMS.find((f: FirmCfg) => f.branchCode === firmCode);
  const countFor = (code: string | null) => summary.find((s) => s.firmCode === code)?._count?._all ?? 0;
  const cachedTotal = summary.reduce((s, r) => s + r._count._all, 0);

  // billing.sud.uz dan sahifama-sahifa yig'adi. Har sahifa alohida so'rov (o'z captcha
  // tokeni bilan) — shuning uchun uzoq so'rov timeout'ga tushmaydi va jarayon ko'rinib turadi.
  // `all=true` bo'lsa oxirgi sahifagacha; aks holda `want` tagacha.
  const sync = useCallback(async (want: number, all: boolean) => {
    if (!activeFirm) return;
    cancelRef.current = false;
    setSyncing(true);
    setErr(null);
    setSyncMsg(null);
    setProg({ done: 0, total: all ? 0 : want });

    let done = 0;
    let serverTotal = 0;
    let failure: string | null = null;

    for (let p = 0; all || done < want; p++) {
      if (cancelRef.current) break;
      const size = all ? SYNC_PAGE : Math.min(SYNC_PAGE, want - done);
      // silent: har sahifa uchun tarix yozuvi yaratilmaydi — oxirida bitta umumiy yoziladi.
      const { ok, json } = await jpost('/api/billing-check/list', { inn: activeFirm.stir, page: p, size, silent: true });
      if (!ok) { failure = json?.error || 'billing.sud.uz javob bermadi'; break; }
      const got = json.content?.length ?? 0;
      done += got;
      serverTotal = json.totalElements ?? serverTotal;
      setProg({ done, total: all ? serverTotal : want });
      if (json.last || got === 0) break;
    }

    const stopped = cancelRef.current;
    setSyncing(false);
    setProg(null);
    if (failure) setErr(`${failure} — shu paytgacha ${done} ta olindi va saqlandi`);
    else setSyncMsg(`${done} ta kvitansiya yangilandi${serverTotal ? ` (billing'da jami: ${serverTotal})` : ''}${stopped ? ' — to‘xtatildi' : ''}`);

    // Tarixga bitta umumiy yozuv.
    await jpost('/api/billing-check/history', {
      query: activeFirm.stir,
      resultCount: done,
      status: failure ? 'FAILED' : 'OK',
      message: failure ? `${failure} (${done} ta olindi)` : `yangilandi: ${done} ta${stopped ? ' (to‘xtatildi)' : ''}`,
    });
    onSynced();
  }, [activeFirm, onSynced]);

  const excelHref = (() => {
    const params = new URLSearchParams();
    if (firmCode) params.set('firm', firmCode);
    if (status) params.set('status', status);
    if (dq) params.set('q', dq);
    return `/api/billing-check/excel?${params.toString()}`;
  })();

  const lastPage = Math.max(0, Math.ceil(total / TABLE_SIZE) - 1);

  return (
    <section className="card space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Kvitansiyalar bazasi</h2>
        <a href={excelHref} className="btn-ghost">
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

      {/* billing dan yangilash */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-2/40 p-3">
        <span className="text-sm text-muted">
          {activeFirm ? <><b>{activeFirm.name.replace(/ MIKROMOLIYA.*$/i, '')}</b> uchun billing.sud.uz dan:</> : 'Yangilash uchun firmani tanlang'}
        </span>
        <button onClick={() => void sync(50, false)} disabled={syncing || !activeFirm} className="btn-ghost">
          {syncing ? <Spinner size={14} className="mr-1.5" /> : <Ico.refresh size={14} className="mr-1 inline" />}Oxirgi 50 ta
        </button>
        <button onClick={() => void sync(0, true)} disabled={syncing || !activeFirm} className="btn-primary">
          {syncing ? <Spinner size={14} className="mr-1.5" /> : null}Hammasini yangilash
        </button>
        {syncing && (
          <>
            <span className="text-sm tabular-nums text-muted">
              {prog?.done ?? 0}{prog?.total ? ` / ${prog.total}` : ''} …
            </span>
            <button onClick={() => { cancelRef.current = true; }} className="btn-ghost !py-1 !px-2 text-rose-600 dark:text-rose-300">
              To‘xtatish
            </button>
          </>
        )}
      </div>
      {syncMsg && <div className="text-sm text-emerald-600 dark:text-emerald-300">{syncMsg}</div>}
      {err && <div className="text-sm text-rose-600 dark:text-rose-300">{err}</div>}

      {/* qidiruv + holat */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
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

      {/* jadval */}
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-xs text-muted">
            <tr>
              <th className="px-3 py-2">Kvitansiya raqami</th>
              <th className="px-3 py-2">Holati</th>
              <th className="px-3 py-2">Summasi</th>
              <th className="px-3 py-2">Da'vo raqami</th>
              <th className="px-3 py-2">Yaratilgan</th>
              <th className="px-3 py-2">Tekshirilgan</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-muted"><Spinner size={16} className="mr-2 inline" />Yuklanmoqda…</td></tr>
            ) : rows.length ? (
              rows.map((row) => (
                <tr key={row.id} className="cursor-pointer border-t border-line/60 hover:bg-surface-2/50" onClick={() => setDetail(row)}>
                  <td className="px-3 py-2 font-mono">{row.number}</td>
                  <td className="px-3 py-2">
                    <span className={cx('badge', STATUS_STYLE[row.invoiceStatus] ?? 'border-line text-muted')}>
                      {STATUS_LABEL[row.invoiceStatus] ?? row.invoiceStatus}
                    </span>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{money(row.amount)}</td>
                  <td className="px-3 py-2">{val(row.claimCaseNumber)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{dt(row.issuedAt)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted">{dt(row.checkedAt)}</td>
                </tr>
              ))
            ) : (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-muted">
                {dq || status ? 'Filtrga mos yozuv yo‘q' : 'Bazada hali kvitansiya yo‘q — «Hammasini yangilash» ni bosing'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* sahifalash */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
        <span className="tabular-nums">
          {total ? `${page * TABLE_SIZE + 1} – ${Math.min((page + 1) * TABLE_SIZE, total)} / ${total}` : '0'}
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
