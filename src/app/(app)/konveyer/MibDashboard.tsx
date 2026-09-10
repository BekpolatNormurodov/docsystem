'use client';

// MIB monitoring DASHBOARD — bitta MibReport ustidan to'liq operator paneli. HAM konveyer modal'i,
// HAM standalone «MIB hisoboti» sahifasi shu bitta komponentni ishlatadi (variant bilan).
//   • Yuqorida: qurish/GO/STOP + KPI (MIBda jami / bizniki % / summalar) + filtrlar (region /
//     hudud / bank / firma) — hamma tab uchun umumiy.
//   • 5 tab: Mijozlar (sahifalanadigan ro'yxat) · Firma · Region · Hudud (MIB) · Bank (kesimlar).
//     Har tabning O'Z Excel yuklamasi bor (?tab=…).
//   • Mijozni bosish — ALOHIDA ICHKI SAHIFA (orqaga tugmasi bilan), tor modal emas: ijro ishlari
//     keng va o'qilishi oson ko'rinadi + o'sha mijozning Excel'i.
// Kesim/region mantig'i src/lib/mib/breakdown.ts dan (server Excel bilan bir xil).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Ico, Spinner, DateField } from '@/ui';
import { type ClientRow } from '../mib-hisoboti/MibClientDetail';
import { ClientDetailFull } from '../mib-hisoboti/ClientDetailFull';
import { MibLogPanel } from '../mib-hisoboti/MibLogPanel';
import { regionOf, groupBreakdown, parseMoney, clean, shortFirm, normalizeBank, type Dim } from '@/lib/mib/breakdown';

interface Report { id: number; createdAt: string; label: string | null; total: number; autoRun: boolean; statusFilter: string | null; sourceFileName?: string }
interface Stats {
  total: number; status: Record<string, number>; withCases: number; totalCases: number; detailedCases: number;
  totalRemainingDebt: number; firms: { name: string; inn: string; cases: number; clients: number; remainingDebt: number }[];
}

const cx = (...c: (string | false | undefined | null)[]) => c.filter(Boolean).join(' ');
const n = (x: number) => (x || 0).toLocaleString('ru-RU');
const som = (x: number) => (x || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 });

async function jget(url: string) { const r = await fetch(url, { cache: 'no-store' }); return r.json().catch(() => ({})); }
async function jpost(url: string, body?: unknown) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { ok: r.ok, status: r.status, json: await r.json().catch(() => ({})) };
}

interface Enriched extends ClientRow {
  region2: string | null;
  depts: string[];
  banks: string[];
  ourFirms: string[];
  ours: boolean;
  remainingSum: number;
  caseCount: number;
  hay: string;
}
function enrich(c: ClientRow): Enriched {
  const depts = new Set<string>(), banks = new Set<string>(), ourFirms = new Set<string>();
  let remainingSum = 0, ours = false;
  for (const k of c.cases) {
    const d = clean(k.executorDept); if (d) depts.add(d);
    const b = normalizeBank(k.bankName); if (b) banks.add(b);
    if (k.isTargetFirm && k.firmName) { ours = true; ourFirms.add(shortFirm(k.firmName)); }
    remainingSum += parseMoney(k.remainingDebt);
  }
  const hay = [c.pinfl, c.fio2, c.fio, c.firm, c.ishRaqami, ...c.cases.map((k) => k.workNumber)].filter(Boolean).join(' ').toLowerCase();
  return { ...c, region2: regionOf(c), depts: [...depts], banks: [...banks], ourFirms: [...ourFirms], ours, remainingSum, caseCount: c.cases.length, hay };
}

type Tab = 'mijozlar' | Dim;
// Kesim (region/hudud/bank/firma) OLDINDA — default «Region»; «Mijozlar» ro'yxati oxirida.
const TABS: { key: Tab; label: string }[] = [
  { key: 'region', label: 'Region' }, { key: 'hudud', label: 'Hudud (MIB)' }, { key: 'bank', label: 'Bank' },
  { key: 'firma', label: 'Firma' }, { key: 'mijozlar', label: 'Mijozlar' },
];
const PAGE_SIZES = [25, 50, 100];
type Own = 'all' | 'ours' | 'others'; // Hammasi / Bizga tegishli / Bizga tegishli emas
const emptyFilters = { q: '', region: '', dept: '', bank: '', firm: '', own: 'all' as Own };
type Filters = typeof emptyFilters;

// ── component ────────────────────────────────────────────────────────────────
export function MibDashboard({ reportId, reseed, variant = 'konveyer', onChanged, clientHrefBase, aggregate = false }: {
  reportId: number;
  reseed?: () => Promise<void>;
  variant?: 'standalone' | 'konveyer';
  onChanged?: () => void | Promise<void>;
  // Berilsa — mijozni bosganda ALOHIDA TO'LIQ SAHIFAga o'tadi (`${clientHrefBase}/<id>`); aks holda
  // ichki ko'rinish (konveyer modal).
  clientHrefBase?: string;
  // UMUMIY rejim — barcha hisobotlar birga (/api/mib/all), faqat o'qish (GO/build/PINFL yo'q).
  aggregate?: boolean;
}) {
  const router = useRouter();
  const [report, setReport] = useState<Report | null>(null);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [tab, setTab] = useState<Tab>('region');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [detailId, setDetailId] = useState<number | null>(null);
  // standalone «Ro'yxatni qurish» — Excel «Holat» + yuborilgan sana
  const [holatValues, setHolatValues] = useState<{ value: string; count: number }[]>([]);
  const [sentRange, setSentRange] = useState<{ min: string | null; max: string | null }>({ min: null, max: null });
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  // bitta PINFL tekshirish
  const [pinfl, setPinfl] = useState('');
  const [addMsg, setAddMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const j = await jget(aggregate ? '/api/mib/all' : `/api/mib/${reportId}`);
    setReport(j.report ?? null); setClients(j.clients ?? []); setStats(j.stats ?? null);
    setHolatValues(j.holatValues ?? []);
    setSentRange(j.sentDateRange ?? { min: null, max: null });
    if (j.report?.statusFilter != null) setStatusFilter(j.report.statusFilter);
  }, [reportId, aggregate]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!report?.autoRun) return;
    const t = setInterval(() => void load(), 3500);
    return () => clearInterval(t);
  }, [report?.autoRun, load]);

  const enriched = useMemo(() => clients.map(enrich), [clients]);

  const opts = useMemo(() => {
    const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
    const R = new Map<string, number>(), D = new Map<string, number>(), B = new Map<string, number>(), F = new Map<string, number>();
    for (const c of enriched) {
      if (c.region2) bump(R, c.region2);
      for (const d of c.depts) bump(D, d);
      for (const b of c.banks) bump(B, b);
      for (const f of c.ourFirms) bump(F, f);
    }
    const sort = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return { regions: sort(R), depts: sort(D), banks: sort(B), firms: sort(F) };
  }, [enriched]);

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return enriched.filter((c) =>
      (!q || c.hay.includes(q)) &&
      (!filters.region || c.region2 === filters.region) &&
      (!filters.dept || c.depts.includes(filters.dept)) &&
      (!filters.bank || c.banks.includes(filters.bank)) &&
      (!filters.firm || c.ourFirms.includes(filters.firm)) &&
      (filters.own === 'all' || (filters.own === 'ours' ? c.ours : !c.ours)),
    );
  }, [enriched, filters]);

  useEffect(() => { setPage(1); }, [filters, pageSize, tab]);

  const fsum = useMemo(() => {
    let cases = 0, ours = 0, debt = 0;
    for (const c of filtered) {
      cases += c.caseCount; debt += c.remainingSum;
      for (const k of c.cases) if (k.isTargetFirm) ours += 1;
    }
    return { clients: filtered.length, cases, ours, debt };
  }, [filtered]);

  const breakdown = useMemo(() => (tab === 'mijozlar' ? [] : groupBreakdown(filtered, tab)), [filtered, tab]);

  const oursCases = stats ? stats.firms.reduce((s, f) => s + f.cases, 0) : 0;
  const oursDebt = stats ? stats.firms.reduce((s, f) => s + f.remainingDebt, 0) : 0;
  const totalCases = stats?.totalCases ?? 0;
  const checked = (stats?.status.DONE ?? 0) + (stats?.status.CLEAN ?? 0);
  const built = (report?.total ?? 0) > 0;
  const pulled = totalCases > 0 || (stats?.detailedCases ?? 0) > 0;
  // «Qo'lda tekshiruvlar» (Excelsiz) — Excel «Holat» / «Ro'yxatni qurish» ko'rsatilmaydi.
  const isManual = (report?.sourceFileName ?? '').startsWith('manual:') || (holatValues.length === 0 && (report?.statusFilter ?? '') === 'Qoʻlda');

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageClamped = Math.min(page, totalPages);
  const pageRows = filtered.slice((pageClamped - 1) * pageSize, pageClamped * pageSize);

  const anyFilter = !!(filters.q || filters.region || filters.dept || filters.bank || filters.firm || filters.own !== 'all');
  const setF = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const jumpFilter = (dim: Dim, label: string) => {
    const key = dim === 'region' ? 'region' : dim === 'hudud' ? 'dept' : dim === 'bank' ? 'bank' : 'firm';
    const cur = filters[key as 'region' | 'dept' | 'bank' | 'firm'];
    setF({ [key]: cur === label ? '' : label } as Partial<Filters>);
    setTab('mijozlar');
  };
  // Standalone — alohida to'liq sahifa; konveyer modal — ichki ko'rinish.
  const openClient = (cid: number) => { if (clientHrefBase) router.push(`${clientHrefBase}/${cid}`); else setDetailId(cid); };

  // controls
  const build = async () => {
    setBusy('build'); setNote('');
    const { ok, json } = await jpost(`/api/mib/${reportId}/build`, { statusFilter: statusFilter || null, dateFrom: dateFrom || null, dateTo: dateTo || null });
    if (!ok) setNote(json.error || 'Xatolik'); else { await load(); await onChanged?.(); }
    setBusy('');
  };
  const go = async () => {
    setBusy('go'); setNote('');
    const { ok, json } = await jpost(`/api/mib/${reportId}/run`);
    if (!ok) { setNote(json.error || 'Xatolik'); setBusy(''); return; }
    if (!json.phoneConfigured) setNote('Diqqat: telefon raqami sozlanmagan — chuqur detal (SMS) olinmaydi, faqat ijro ishlari roʻyxati.');
    await load(); await onChanged?.(); setBusy('');
  };
  const stop = async () => { setBusy('stop'); await jpost(`/api/mib/${reportId}/stop`); await load(); await onChanged?.(); setBusy(''); };
  const doReseed = async () => { setBusy('reseed'); await reseed?.(); await load(); await onChanged?.(); setBusy(''); };
  const addPinfl = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = pinfl.replace(/\D/g, '');
    if (p.length !== 14) { setAddMsg({ ok: false, text: 'PINFL 14 ta raqam boʻlishi kerak' }); return; }
    setBusy('add'); setAddMsg(null);
    const { ok, json } = await jpost(`/api/mib/${reportId}/add-pinfl`, { pinfl: p });
    if (!ok) setAddMsg({ ok: false, text: json.error || 'Xatolik' });
    else {
      setPinfl(''); setAddMsg({ ok: true, text: json.running ? `${p} qoʻshildi — tekshirilmoqda…` : `${p} qoʻshildi (navbatda)` });
      await load(); await onChanged?.();
      // Standalone: darhol o'sha PINFL sahifasini ochamiz — natija to'lishini kuzatasiz.
      if (clientHrefBase && json.clientId) router.push(`${clientHrefBase}/${json.clientId}`);
    }
    setBusy('');
  };

  if (!report) return <div className="grid place-items-center py-16"><Spinner /></div>;

  // ── Ichki ko'rinish (konveyer modal): mijoz detali ─────────────────────────
  if (detailId != null) return <ClientDetailFull reportId={reportId} clientId={detailId} onBack={() => setDetailId(null)} />;

  const excelHref = tab === 'mijozlar' ? `/api/mib/${reportId}/excel` : `/api/mib/${reportId}/excel?tab=${tab}`;

  return (
    <div className="space-y-4">
      {/* ── standalone: «Holat» + sana → Ro'yxatni qurish ────────────────── */}
      {variant === 'standalone' && !report.autoRun && !isManual && !aggregate && (
        <div className="card space-y-3 p-3">
          <div>
            <span className="field-label">«Holat» boʻyicha (Excel)</span>
            <div className="flex flex-wrap gap-2">
              <MiniChip active={statusFilter === ''} onClick={() => setStatusFilter('')}>Barchasi</MiniChip>
              {holatValues.map((h) => (
                <MiniChip key={h.value} active={statusFilter === h.value} onClick={() => setStatusFilter(h.value)}>
                  {h.value} <span className="opacity-60">· {h.count}</span>
                </MiniChip>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-[168px]"><DateField label="Yuborilgan sana — dan" value={dateFrom} onChange={setDateFrom} min={sentRange.min ?? undefined} max={sentRange.max ?? undefined} /></div>
            <div className="w-[168px]"><DateField label="gacha" value={dateTo} onChange={setDateTo} min={sentRange.min ?? undefined} max={sentRange.max ?? undefined} /></div>
            {(dateFrom || dateTo) && <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => { setDateFrom(''); setDateTo(''); }}>Sanani tozalash</button>}
            <div className="flex-1" />
            <button className="btn-ghost shrink-0" disabled={busy === 'build'} onClick={build}>{busy === 'build' ? <Spinner size={16} /> : <Ico.refresh size={16} />} Roʻyxatni qurish</button>
          </div>
        </div>
      )}

      {/* ── control bar ─────────────────────────────────────────────────── */}
      {aggregate ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Ico.layer size={16} className="text-brand-600 dark:text-brand-400" />
          <span><b className="text-fg">Umumiy</b> · barcha hisobotlar birga · <b className="tabular-nums text-fg">{n(report.total)}</b> ta mijoz (PINFL bo‘yicha yagona)</span>
        </div>
      ) : (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-muted">
          {report.autoRun ? (
            <span className="flex items-center gap-2 font-medium text-emerald-600 dark:text-emerald-300">
              <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" /></span>
              Avtomator ishlayapti — {n(checked)}/{n(report.total)} tekshirildi
            </span>
          ) : (
            <span>
              {variant === 'standalone' && <b className="text-fg">{statusFilter || 'Barchasi'}</b>}{variant === 'standalone' && ' · '}
              {variant === 'konveyer' && 'Konveyerdan '}<b className="tabular-nums text-fg">{n(report.total)}</b> ta mijoz · mib.uz dan tekshiriladi
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {reseed && !report.autoRun && (
            <button className="btn-ghost shrink-0" disabled={busy === 'reseed'} onClick={doReseed}>
              {busy === 'reseed' ? <Spinner size={16} /> : <Ico.refresh size={16} />} Konveyerdan yangilash
            </button>
          )}
          {report.autoRun ? (
            <button className="btn-danger shrink-0" disabled={busy === 'stop'} onClick={stop}>{busy === 'stop' ? <Spinner size={16} /> : <Ico.minus size={16} />} STOP</button>
          ) : (
            <button className="btn-primary shrink-0" disabled={!built || busy === 'go'} onClick={go}>{busy === 'go' ? <Spinner size={16} /> : <Ico.flash size={16} />} GO — tekshirish</button>
          )}
        </div>
      </div>
      )}
      {note && <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-600 dark:text-amber-300">{note}</p>}
      {variant === 'standalone' && !built && !report.autoRun && !aggregate && (
        <div className="rounded-xl border border-dashed border-line bg-surface-2/40 px-4 py-3 text-sm text-muted">
          Excel yuklandi. Yuqorida «Holat» (masalan <b className="text-fg">MIBda</b>) ni tanlab <b className="text-fg">Roʻyxatni qurish</b> bosing, soʻng <b className="text-fg">GO</b>.
        </div>
      )}

      {/* ── bitta PINFL tekshirish — FAQAT konveyer modalида (standalone sahifada tepada alohida
             kartada turadi, shuning uchun bu yerda takror ko'rsatmaymiz) ────────────────── */}
      {variant === 'konveyer' && (
        <form onSubmit={addPinfl} className="card flex flex-wrap items-center gap-2 p-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-500/12 text-brand-600 dark:text-brand-300"><Ico.qr size={16} /></span>
          <span className="text-sm font-medium">Bitta PINFL tekshirish:</span>
          <input className="field-input w-[190px] tabular-nums tracking-[0.1em]" inputMode="numeric" maxLength={14} placeholder="14 raqamli PINFL"
            value={pinfl} onChange={(e) => { setPinfl(e.target.value.replace(/\D/g, '').slice(0, 14)); setAddMsg(null); }} />
          <button type="submit" className="btn-primary shrink-0" disabled={busy === 'add' || pinfl.replace(/\D/g, '').length !== 14}>
            {busy === 'add' ? <Spinner size={16} /> : <Ico.send size={16} />} Tekshirish
          </button>
          {addMsg && <span className={cx('text-sm', addMsg.ok ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300')}>{addMsg.text}</span>}
          <span className="ml-auto text-xs text-muted">natija ijro ishlari + sana bilan shu roʻyxatga yigʻiladi</span>
        </form>
      )}

      {/* ── KPI: MIBda jami / bizniki / summalar ─────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi big icon={<Ico.layer size={18} />} label="MIBda jami ijro ishlari" value={n(totalCases)} hint={`${n(stats?.withCases ?? 0)} mijozda topildi`} />
        <Kpi big accent icon={<Ico.shield size={18} />} label="Bizga tegishli (8 MMT)" value={n(oursCases)} hint={totalCases ? `jamining ${Math.round((oursCases / totalCases) * 100)}%` : '—'} />
        <Kpi icon={<Ico.users size={18} />} label="Boshqa kreditorlar" value={n(Math.max(0, totalCases - oursCases))} hint="davlat boji / bank / boshqa" />
        <Kpi icon={<Ico.check size={18} />} label="Tekshirildi" value={`${n(checked)} / ${n(report.total)}`} hint={`${n(stats?.status.PENDING ?? 0)} navbatda · ${n(stats?.status.FAILED ?? 0)} xato`} />
        <Kpi wide label="Qoldiq qarz — jami (soʻm)" value={som(stats?.totalRemainingDebt ?? 0)} icon={<Ico.receipt size={18} />} />
        <Kpi wide accent label="shundan bizning qoldiq qarz (soʻm)" value={som(oursDebt)} icon={<Ico.receipt size={18} />} />
      </div>

      {built && !pulled && !report.autoRun && (
        <div className="rounded-xl border border-dashed border-line bg-surface-2/40 px-4 py-3 text-sm text-muted">
          Ijro ishlari hali mib.uz dan tortilmagan. <b className="text-fg">GO</b> bosilsa har mijoz ketma-ket tekshiriladi —
          region / hudud / bank kesimlari va summalar shundan keyin toʻladi.
        </div>
      )}

      {/* ── filters (hamma tab uchun umumiy) ─────────────────────────────── */}
      <div className="card p-3">
        <div className="flex flex-wrap items-end gap-2.5">
          <label className="min-w-[190px] flex-1">
            <span className="field-label">Qidiruv (PINFL / F.I.O / ish №)</span>
            <input className="field-input" value={filters.q} onChange={(e) => setF({ q: e.target.value })} placeholder="qidirish…" />
          </label>
          <FilterSelect label="Region" value={filters.region} onChange={(v) => setF({ region: v })} options={opts.regions} />
          <FilterSelect label="Hudud (MIB boʻlimi)" value={filters.dept} onChange={(v) => setF({ dept: v })} options={opts.depts} wide />
          <FilterSelect label="Bank" value={filters.bank} onChange={(v) => setF({ bank: v })} options={opts.banks} wide />
          <FilterSelect label="Firma" value={filters.firm} onChange={(v) => setF({ firm: v })} options={opts.firms} />
          <div className="shrink-0">
            <span className="field-label">Tegishlilik</span>
            <div className="flex h-[42px] items-center gap-0.5 rounded-xl border border-line p-0.5">
              {([['all', 'Hammasi'], ['ours', 'Bizniki'], ['others', 'Tegishli emas']] as [Own, string][]).map(([v, lbl]) => (
                <button key={v} onClick={() => setF({ own: v })}
                  className={cx('rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors', filters.own === v ? 'bg-brand-500 text-white shadow-sm' : 'text-muted hover:text-fg')}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>
          {anyFilter && <button className="btn-ghost h-[42px] shrink-0 self-end text-xs" onClick={() => setFilters(emptyFilters)}><Ico.close size={14} /> Tozalash</button>}
        </div>
      </div>

      {/* ── tabs + Excel ─────────────────────────────────────────────────── */}
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-2 py-2">
          <div className="flex flex-wrap items-center gap-1">
            {TABS.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={cx('rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  tab === t.key ? 'bg-brand-500/12 text-brand-700 dark:text-brand-300' : 'text-muted hover:bg-surface-2 hover:text-fg')}>
                {t.label}
              </button>
            ))}
          </div>
          {!aggregate && <a className="btn-ghost mr-1 shrink-0 text-xs" href={excelHref}><Ico.download size={14} /> Excel{tab !== 'mijozlar' ? ' (kesim)' : ''}</a>}
        </div>

        {/* summary line for the active view */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-2/30 px-3 py-2 text-sm">
          <div>
            <span className="font-semibold">{n(fsum.clients)}</span> <span className="text-muted">mijoz{anyFilter ? ' (filtrlangan)' : ''}</span>
            <span className="text-muted"> · </span><span className="tabular-nums font-medium">{n(fsum.cases)}</span> <span className="text-muted">ijro ishi</span>
            {fsum.ours > 0 && <><span className="text-muted"> · </span><span className="tabular-nums font-medium text-emerald-600 dark:text-emerald-300">{n(fsum.ours)}</span> <span className="text-muted">bizniki</span></>}
            <span className="text-muted"> · qoldiq </span><span className="tabular-nums font-medium">{som(fsum.debt)}</span>
          </div>
          {tab !== 'mijozlar' && <span className="text-xs text-muted">{n(breakdown.length)} ta guruh · qatordan bosib filtrlang</span>}
          {tab === 'mijozlar' && report.autoRun && <span className="flex items-center gap-1.5 text-xs text-muted"><Spinner size={12} /> jonli</span>}
        </div>

        {tab === 'mijozlar' ? (
          <>
            <div className="max-h-[52vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-surface text-xs uppercase tracking-wide text-muted">
                  <tr className="border-b border-line">
                    <th className="px-3 py-2 text-left">PINFL / F.I.O</th>
                    <th className="px-3 py-2 text-left">Firma</th>
                    <th className="px-3 py-2 text-left">Hudud (MIB)</th>
                    <th className="px-3 py-2 text-left">Bank</th>
                    <th className="px-3 py-2 text-right">Ijro</th>
                    <th className="px-3 py-2 text-right">Qoldiq qarz</th>
                    <th className="px-3 py-2 text-center">Holati</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((c) => (
                    <tr key={c.id}
                      className={cx('border-b border-line/60 transition-colors', c.status === 'RUNNING' && 'bg-amber-500/5', c.caseCount > 0 && 'cursor-pointer hover:bg-surface-2')}
                      onClick={() => c.caseCount > 0 && openClient(c.id)}>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5 font-medium tabular-nums">{c.caseCount > 0 && <Ico.eye size={13} className="shrink-0 text-brand-500" />}{c.pinfl}</div>
                        <div className="truncate text-xs text-muted">{clean(c.fio2) || clean(c.fio) || '—'}</div>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {c.ourFirms.length
                          ? c.ourFirms.map((f) => <span key={f} className="badge mr-1 border-emerald-500/30 text-emerald-600 dark:text-emerald-300">{f}</span>)
                          : <span className="text-muted">{clean(c.firm) || '—'}</span>}
                      </td>
                      <td className="px-3 py-2 text-xs">{c.depts.length ? <span className="line-clamp-1">{c.depts.join(', ')}</span> : <span className="text-muted">—</span>}</td>
                      <td className="px-3 py-2 text-xs">{c.banks.length ? <span className="line-clamp-1">{c.banks.join(', ')}</span> : <span className="text-muted">—</span>}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{c.caseCount || (c.status === 'CLEAN' ? '0' : '')}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{c.remainingSum > 0 ? som(c.remainingSum) : '—'}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={cx('badge', STATUS_STYLE[c.status] ?? 'border-line text-muted')}>
                          {c.status === 'RUNNING' ? <Spinner size={11} className="mr-1" /> : null}{STATUS_LABEL[c.status] ?? c.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {pageRows.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-muted">{anyFilter ? 'Filtрga mos mijoz yoʻq.' : 'Roʻyxat boʻsh.'}</td></tr>}
                </tbody>
              </table>
            </div>
            {filtered.length > 0 && <Pager page={pageClamped} totalPages={totalPages} total={filtered.length} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} />}
          </>
        ) : (
          <BreakdownTable rows={breakdown} dim={tab} activeLabel={filters[tab === 'region' ? 'region' : tab === 'hudud' ? 'dept' : tab === 'bank' ? 'bank' : 'firm']} onPick={(label) => jumpFilter(tab, label)} />
        )}
      </div>

      {/* Avtomator logi — jonli (SMS, tekshiruv qadamlari, xatolar) */}
      <MibLogPanel title="Avtomator logi" defaultOpen={report.autoRun} />
    </div>
  );
}


// ── breakdown table (Firma / Region / Hudud / Bank tabs) ────────────────────────
type BRow = { label: string; cases: number; clients: number; ours: number; debt: number };
function BreakdownTable({ rows, dim, activeLabel, onPick }: { rows: BRow[]; dim: Dim; activeLabel: string; onPick: (label: string) => void }) {
  const [showOthers, setShowOthers] = useState(false);
  const head = dim === 'firma' ? 'Firma' : dim === 'region' ? 'Region' : dim === 'hudud' ? 'Hudud (MIB boʻlimi)' : 'Bank';
  const totals = rows.reduce((a, r) => ({ cases: a.cases + r.cases, ours: a.ours + r.ours, debt: a.debt + r.debt }), { cases: 0, ours: 0, debt: 0 });
  if (rows.length === 0) return <p className="px-4 py-10 text-center text-sm text-muted">Maʼlumot yoʻq — GO bosib tekshiring yoki filtrni oʻzgartiring.</p>;

  // Firma kesimida: bizga tegishli (ours>0) YUQORIDA, tegishli emas (ours===0) PASTDA yopiq (default).
  const isFirma = dim === 'firma';
  const oursRows = isFirma ? rows.filter((r) => r.ours > 0) : rows;
  const otherRows = isFirma ? rows.filter((r) => r.ours === 0) : [];
  const otherTot = otherRows.reduce((a, r) => ({ cases: a.cases + r.cases, debt: a.debt + r.debt }), { cases: 0, debt: 0 });

  const Row = (r: BRow) => {
    const active = activeLabel === r.label;
    return (
      <tr key={r.label} onClick={() => onPick(r.label)}
        className={cx('cursor-pointer border-b border-line/60 transition-colors hover:bg-surface-2', active && 'bg-brand-500/10')}>
        <td className="px-3 py-2.5"><span className="line-clamp-2">{r.label}</span></td>
        <td className="px-3 py-2.5 text-right tabular-nums font-medium">{n(r.cases)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums">{r.ours ? <span className="text-emerald-600 dark:text-emerald-300">{n(r.ours)}</span> : <span className="text-muted">0</span>}</td>
        <td className="px-3 py-2.5 text-right tabular-nums text-muted">{n(r.clients)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums">{som(r.debt)}</td>
      </tr>
    );
  };

  return (
    <div className="max-h-[52vh] overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-surface text-xs uppercase tracking-wide text-muted">
          <tr className="border-b border-line">
            <th className="px-3 py-2 text-left">{head}</th>
            <th className="px-3 py-2 text-right">Ijro ishi</th>
            <th className="px-3 py-2 text-right">Bizniki</th>
            <th className="px-3 py-2 text-right">Mijoz</th>
            <th className="px-3 py-2 text-right">Qoldiq qarz</th>
          </tr>
        </thead>
        <tbody>
          {oursRows.map(Row)}
          {isFirma && otherRows.length > 0 && (
            <>
              <tr className="border-y border-line bg-surface-2/50">
                <td colSpan={5} className="px-3 py-2">
                  <button onClick={() => setShowOthers((v) => !v)} className="flex w-full items-center gap-2 text-left text-sm font-medium text-muted hover:text-fg">
                    <svg className={cx('h-4 w-4 shrink-0 transition-transform', showOthers && 'rotate-90')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
                    Bizga tegishli emas <span className="opacity-70">({n(otherRows.length)} ta · {n(otherTot.cases)} ish · qoldiq {som(otherTot.debt)})</span>
                    <span className="ml-auto text-xs opacity-60">{showOthers ? 'yopish' : 'ochish'}</span>
                  </button>
                </td>
              </tr>
              {showOthers && otherRows.map(Row)}
            </>
          )}
          {oursRows.length === 0 && !isFirma && null}
        </tbody>
        <tfoot className="sticky bottom-0 bg-surface">
          <tr className="border-t border-line font-semibold">
            <td className="px-3 py-2.5">Jami · {n(rows.length)} guruh</td>
            <td className="px-3 py-2.5 text-right tabular-nums">{n(totals.cases)}</td>
            <td className="px-3 py-2.5 text-right tabular-nums text-emerald-600 dark:text-emerald-300">{n(totals.ours)}</td>
            <td className="px-3 py-2.5 text-right tabular-nums text-muted">—</td>
            <td className="px-3 py-2.5 text-right tabular-nums">{som(totals.debt)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

const STATUS_STYLE: Record<string, string> = {
  PENDING: 'border-slate-400/30 text-muted', RUNNING: 'border-amber-500/30 text-amber-600 dark:text-amber-300',
  DONE: 'border-emerald-500/30 text-emerald-600 dark:text-emerald-300', CLEAN: 'border-sky-500/30 text-sky-600 dark:text-sky-300',
  FAILED: 'border-rose-500/30 text-rose-600 dark:text-rose-300',
};
const STATUS_LABEL: Record<string, string> = { PENDING: 'Navbatda', RUNNING: 'Tekshirilmoqda', DONE: 'Topildi', CLEAN: 'Toza', FAILED: 'Xato' };

function Kpi({ label, value, hint, icon, accent, big, wide }: { label: string; value: string; hint?: string; icon?: React.ReactNode; accent?: boolean; big?: boolean; wide?: boolean }) {
  return (
    <div className={cx('card flex items-center gap-3 p-3', wide && 'lg:col-span-2')}>
      {icon && <span className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-xl', accent ? 'bg-brand-500/12 text-brand-600 dark:text-brand-300' : 'bg-surface-2 text-muted')}>{icon}</span>}
      <div className="min-w-0">
        <div className={cx('font-semibold tabular-nums', big ? 'text-2xl' : 'text-lg', accent && 'text-brand-600 dark:text-brand-400')}>{value}</div>
        <div className="truncate text-xs text-muted">{label}</div>
        {hint && <div className="truncate text-[11px] text-muted/80">{hint}</div>}
      </div>
    </div>
  );
}

function MiniChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={cx('rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
        active ? 'border-brand-500 bg-brand-500/10 text-brand-700 dark:text-brand-300' : 'border-line text-muted hover:bg-surface-2 hover:text-fg')}>
      {children}
    </button>
  );
}

// Pro, qidiruvli dropdown — filtr uchun (native select o'rniga). Ko'p variant (hudud/bank) bo'lsa
// qidiruv chiqadi; har variant yonida son; tanlangani belgilanadi; tashqariga bosilса yopiladi.
function FilterSelect({ label, value, onChange, options, wide }: { label: string; value: string; onChange: (v: string) => void; options: [string, number][]; wide?: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const disabled = options.length === 0;
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const needle = q.trim().toLowerCase();
  const shown = needle ? options.filter(([v]) => v.toLowerCase().includes(needle)) : options;
  const pick = (v: string) => { onChange(v); setOpen(false); setQ(''); };
  const Row = ({ v, c, active }: { v: string; c?: number; active: boolean }) => (
    <button type="button" onClick={() => pick(v)}
      className={cx('flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors', active ? 'bg-brand-500/10 font-medium text-brand-700 dark:text-brand-300' : 'hover:bg-surface-2')}>
      <span className="min-w-0 flex-1 truncate">{v || 'Barchasi'}</span>
      {c != null && <span className="shrink-0 text-[11px] tabular-nums text-muted">{c}</span>}
      {active && <Ico.check size={15} className="shrink-0 text-brand-600 dark:text-brand-400" />}
    </button>
  );
  return (
    <div ref={box} className={cx('relative shrink-0', wide ? 'w-[210px]' : 'w-[168px]')}>
      <span className="field-label">{label}</span>
      <button type="button" disabled={disabled} onClick={() => setOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={open}
        className={cx('flex h-[42px] w-full items-center justify-between gap-2 rounded-xl border bg-surface px-3 text-sm transition-colors',
          open ? 'border-brand-500 ring-2 ring-brand-500/15' : 'border-line hover:border-brand-500/60', disabled && 'cursor-not-allowed opacity-50')}>
        <span className={cx('truncate', !value && 'text-muted')}>
          {value || <>Barchasi{options.length ? <span className="opacity-70"> ({options.length})</span> : null}</>}
        </span>
        <svg className={cx('h-4 w-4 shrink-0 text-muted transition-transform', open && 'rotate-180')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {open && (
        <div role="listbox" className="absolute left-0 right-0 z-50 mt-1.5 rounded-xl border border-line bg-surface p-1 shadow-2xl">
          {options.length > 6 && (
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="qidirish…"
              className="mb-1 w-full rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-sm outline-none focus:border-brand-500" />
          )}
          <div className="max-h-64 overflow-auto">
            <Row v="" active={!value} />
            {shown.map(([v, c]) => <Row key={v} v={v} c={c} active={value === v} />)}
            {shown.length === 0 && <div className="px-2 py-3 text-center text-xs text-muted">Topilmadi</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function Pager({ page, totalPages, total, pageSize, onPage, onPageSize }: { page: number; totalPages: number; total: number; pageSize: number; onPage: (p: number) => void; onPageSize: (s: number) => void }) {
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const nums: (number | '…')[] = [];
  const win = new Set<number>([1, totalPages, page, page - 1, page + 1, page - 2, page + 2]);
  let prev = 0;
  for (let i = 1; i <= totalPages; i++) {
    if (!win.has(i)) continue;
    if (i - prev > 1) nums.push('…');
    nums.push(i); prev = i;
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2.5 text-sm">
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="tabular-nums">{n(from)}–{n(to)} / {n(total)}</span>
        <select className="rounded-lg border border-line bg-surface px-2 py-1 text-xs" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
          {PAGE_SIZES.map((s) => <option key={s} value={s}>{s} / sahifa</option>)}
        </select>
      </div>
      <div className="flex items-center gap-1">
        <button className="grid h-8 w-8 place-items-center rounded-lg border border-line text-muted transition-colors hover:bg-surface-2 disabled:opacity-40" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Oldingi"><Ico.chevron size={16} className="rotate-180" /></button>
        {nums.map((x, i) => x === '…'
          ? <span key={`d${i}`} className="px-1 text-muted">…</span>
          : <button key={x} onClick={() => onPage(x)} aria-current={x === page}
              className={cx('h-8 min-w-8 rounded-lg px-2 text-sm tabular-nums transition-colors', x === page ? 'bg-brand-500 text-white' : 'border border-line text-muted hover:bg-surface-2')}>{x}</button>)}
        <button className="grid h-8 w-8 place-items-center rounded-lg border border-line text-muted transition-colors hover:bg-surface-2 disabled:opacity-40" disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label="Keyingi"><Ico.chevron size={16} /></button>
      </div>
    </div>
  );
}
