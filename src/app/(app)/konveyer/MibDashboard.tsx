'use client';

// MIB monitoring DASHBOARD — modal ichida ochiladigan to'liq operator paneli.
// Bitta MibReport (konveyerdan urug'langan) ustidan ishlaydi: mib.uz dan tortilgan ijro
// ishlarini REGION / HUDUD (MIB bo'limi) / BANK / FIRMA bo'yicha filtrlaydi, summalar va
// «MIBda jami nechta ariza, nechtasi bizniki» kesimini ko'rsatadi, ro'yxatni sahifalaydi.
// Ma'lumot /api/mib/[id] dan keladi (report + clients + cases + stats) — barcha kesim/filtr
// mijoz+case massividan MIJOZ TOMONDA hisoblanadi, qo'shimcha API kerak emas.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Ico, Spinner, Modal, DateField } from '@/ui';
import { ClientDetail, type ClientRow } from '../mib-hisoboti/MibClientDetail';

// ── shapes ──────────────────────────────────────────────────────────────────
interface Report { id: number; createdAt: string; label: string | null; total: number; autoRun: boolean; statusFilter: string | null }
interface Stats {
  total: number; status: Record<string, number>; withCases: number; totalCases: number; detailedCases: number;
  totalRemainingDebt: number; firms: { name: string; inn: string; cases: number; clients: number; remainingDebt: number }[];
}

const cx = (...c: (string | false | undefined | null)[]) => c.filter(Boolean).join(' ');
const n = (x: number) => (x || 0).toLocaleString('ru-RU');
const som = (x: number) => (x || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 });
const clean = (s: string | null | undefined) => (s && s !== 'Nomaʼlum' ? s.trim() : '');
const shortFirm = (s: string) => s.replace(/ MIKROMOLIYA.*$/i, '').replace(/["«»]/g, '').trim();
const parseMoney = (s: string | null | undefined): number => {
  if (!s) return 0;
  const v = Number(String(s).replace(/[^\d.,-]/g, '').replace(/\s+/g, '').replace(',', '.'));
  return Number.isFinite(v) ? v : 0;
};

async function jget(url: string) { const r = await fetch(url, { cache: 'no-store' }); return r.json().catch(() => ({})); }
async function jpost(url: string, body?: unknown) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { ok: r.ok, status: r.status, json: await r.json().catch(() => ({})) };
}

// Regionni MIB bo'limi / sud organi matnidan aniqlaymiz (kirill + lotin). Toshkent SHAHRI
// «Toshkent» ni tekshirishdan OLDIN — aks holda hammasi «viloyat»ga tushib qoladi.
const REGION_TOKENS: [RegExp, string][] = [
  [/қорақалпоғ|qoraqalpog|karakalpak/i, 'Qoraqalpogʻiston'],
  [/андижон|andijon/i, 'Andijon'],
  [/бухоро|buxoro|bukhara/i, 'Buxoro'],
  [/жиззах|jizzax/i, 'Jizzax'],
  [/қашқадарё|qashqadaryo|kashkadar/i, 'Qashqadaryo'],
  [/навоий|navoiy/i, 'Navoiy'],
  [/наманган|namangan/i, 'Namangan'],
  [/самарқанд|samarqand|samarkand/i, 'Samarqand'],
  [/сурхондарё|surxondaryo|surkhandar/i, 'Surxondaryo'],
  [/сирдарё|sirdaryo|syrdar/i, 'Sirdaryo'],
  [/фарғона|fargʻona|fargona|fergana/i, 'Fargʻona'],
  [/хоразм|xorazm|khorezm/i, 'Xorazm'],
  [/тошкент\s*шаҳ|toshkent\s*shah|tashkent\s*city/i, 'Toshkent shahri'],
  [/тошкент|toshkent|tashkent/i, 'Toshkent viloyati'],
];
function regionFromText(t: string): string | null {
  for (const [re, name] of REGION_TOKENS) if (re.test(t)) return name;
  return null;
}

interface Enriched extends ClientRow {
  region2: string | null;
  depts: string[];
  banks: string[];
  ourFirms: string[];
  ours: boolean;
  remainingSum: number;
  caseCount: number;
  hay: string; // lowercased search haystack
}
function enrich(c: ClientRow): Enriched {
  const depts = new Set<string>();
  const banks = new Set<string>();
  const ourFirms = new Set<string>();
  let region2: string | null = clean(c.region) || null;
  let remainingSum = 0;
  let ours = false;
  for (const k of c.cases) {
    const d = clean(k.executorDept); if (d) depts.add(d);
    const b = clean(k.bankName); if (b) banks.add(b);
    if (k.isTargetFirm && k.firmName) { ours = true; ourFirms.add(shortFirm(k.firmName)); }
    remainingSum += parseMoney(k.remainingDebt);
    if (!region2) region2 = regionFromText(`${k.executorDept ?? ''} ${k.courtOrgan ?? ''}`);
  }
  const hay = [c.pinfl, c.fio2, c.fio, c.firm, c.ishRaqami, ...c.cases.map((k) => k.workNumber)].filter(Boolean).join(' ').toLowerCase();
  return { ...c, region2, depts: [...depts], banks: [...banks], ourFirms: [...ourFirms], ours, remainingSum, caseCount: c.cases.length, hay };
}

type Dim = 'firma' | 'region' | 'hudud' | 'bank';
const DIMS: { key: Dim; label: string }[] = [
  { key: 'firma', label: 'Firma' }, { key: 'region', label: 'Region' },
  { key: 'hudud', label: 'Hudud (MIB)' }, { key: 'bank', label: 'Bank' },
];

const PAGE_SIZES = [25, 50, 100];
const emptyFilters = { q: '', region: '', dept: '', bank: '', firm: '', ours: false };
type Filters = typeof emptyFilters;

// ── component ────────────────────────────────────────────────────────────────
export function MibDashboard({ reportId, reseed, variant = 'konveyer', onChanged }: {
  reportId: number;
  reseed?: () => Promise<void>;
  variant?: 'standalone' | 'konveyer';
  onChanged?: () => void | Promise<void>;
}) {
  const [report, setReport] = useState<Report | null>(null);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [dim, setDim] = useState<Dim>('firma');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [detailId, setDetailId] = useState<number | null>(null);
  // standalone «Ro'yxatni qurish» — Excel «Holat» + yuborilgan sana bo'yicha
  const [holatValues, setHolatValues] = useState<{ value: string; count: number }[]>([]);
  const [sentRange, setSentRange] = useState<{ min: string | null; max: string | null }>({ min: null, max: null });
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const load = useCallback(async () => {
    const j = await jget(`/api/mib/${reportId}`);
    setReport(j.report ?? null); setClients(j.clients ?? []); setStats(j.stats ?? null);
    setHolatValues(j.holatValues ?? []);
    setSentRange(j.sentDateRange ?? { min: null, max: null });
    if (j.report?.statusFilter != null) setStatusFilter(j.report.statusFilter);
  }, [reportId]);
  useEffect(() => { void load(); }, [load]);

  // Jonli yangilanish — avtomator ishlab turганда.
  useEffect(() => {
    if (!report?.autoRun) return;
    const t = setInterval(() => void load(), 3500);
    return () => clearInterval(t);
  }, [report?.autoRun, load]);

  const enriched = useMemo(() => clients.map(enrich), [clients]);

  // Filtr variantlari (butun ro'yxatdan — mijoz soni bilan).
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
      (!filters.ours || c.ours),
    );
  }, [enriched, filters]);

  // Filtr o'zgarsa — birinchi sahifaga.
  useEffect(() => { setPage(1); }, [filters, pageSize]);

  // Filtrlangan to'plam bo'yicha jami (summalar).
  const fsum = useMemo(() => {
    let cases = 0, ours = 0, debt = 0, oursDebt = 0;
    for (const c of filtered) {
      cases += c.caseCount;
      debt += c.remainingSum;
      for (const k of c.cases) if (k.isTargetFirm) { ours += 1; oursDebt += parseMoney(k.remainingDebt); }
    }
    return { clients: filtered.length, cases, ours, debt, oursDebt };
  }, [filtered]);

  // Kesim (group-by) jadvali — filtrlangan mijozlarning case'lari bo'yicha.
  const breakdown = useMemo(() => {
    const rows = new Map<string, { label: string; cases: number; clients: Set<number>; ours: number; debt: number }>();
    const add = (key: string, label: string, cl: number, isOurs: boolean, debt: number) => {
      const r = rows.get(key) ?? { label, cases: 0, clients: new Set<number>(), ours: 0, debt: 0 };
      r.cases += 1; r.clients.add(cl); if (isOurs) r.ours += 1; r.debt += debt; rows.set(key, r);
    };
    for (const c of filtered) {
      for (const k of c.cases) {
        const debt = parseMoney(k.remainingDebt);
        if (dim === 'firma') { const l = k.firmName ? shortFirm(k.firmName) : 'Boshqa kreditorlar'; add(l, l, c.id, !!k.isTargetFirm, debt); }
        else if (dim === 'region') { const l = c.region2 ?? 'Aniqlanmagan'; add(l, l, c.id, !!k.isTargetFirm, debt); }
        else if (dim === 'hudud') { const l = clean(k.executorDept) || 'Aniqlanmagan'; add(l, l, c.id, !!k.isTargetFirm, debt); }
        else { const l = clean(k.bankName) || 'Aniqlanmagan'; add(l, l, c.id, !!k.isTargetFirm, debt); }
      }
    }
    return [...rows.values()].map((r) => ({ label: r.label, cases: r.cases, clients: r.clients.size, ours: r.ours, debt: r.debt }))
      .sort((a, b) => b.cases - a.cases || b.debt - a.debt);
  }, [filtered, dim]);

  const oursCases = stats ? stats.firms.reduce((s, f) => s + f.cases, 0) : 0;
  const oursDebt = stats ? stats.firms.reduce((s, f) => s + f.remainingDebt, 0) : 0;
  const totalCases = stats?.totalCases ?? 0;
  const checked = (stats?.status.DONE ?? 0) + (stats?.status.CLEAN ?? 0);
  const built = (report?.total ?? 0) > 0;
  const pulled = totalCases > 0 || (stats?.detailedCases ?? 0) > 0;

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageClamped = Math.min(page, totalPages);
  const pageRows = filtered.slice((pageClamped - 1) * pageSize, pageClamped * pageSize);

  const anyFilter = filters.q || filters.region || filters.dept || filters.bank || filters.firm || filters.ours;
  const setF = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

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

  if (!report) return <div className="grid place-items-center py-16"><Spinner /></div>;

  return (
    <div className="space-y-4">
      {/* ── standalone: «Holat» + sana → Ro'yxatni qurish ────────────────── */}
      {variant === 'standalone' && !report.autoRun && (
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
          <a className="btn-ghost shrink-0" href={`/api/mib/${reportId}/excel`}><Ico.download size={16} /> Excel</a>
          {report.autoRun ? (
            <button className="btn-danger shrink-0" disabled={busy === 'stop'} onClick={stop}>{busy === 'stop' ? <Spinner size={16} /> : <Ico.minus size={16} />} STOP</button>
          ) : (
            <button className="btn-primary shrink-0" disabled={!built || busy === 'go'} onClick={go}>{busy === 'go' ? <Spinner size={16} /> : <Ico.flash size={16} />} GO — tekshirish</button>
          )}
        </div>
      </div>
      {note && <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-600 dark:text-amber-300">{note}</p>}
      {variant === 'standalone' && !built && !report.autoRun && (
        <div className="rounded-xl border border-dashed border-line bg-surface-2/40 px-4 py-3 text-sm text-muted">
          Excel yuklandi. Yuqorida «Holat» (masalan <b className="text-fg">MIBda</b>) ni tanlab <b className="text-fg">Roʻyxatni qurish</b> bosing —
          tekshiriladigan mijozlar shakllanadi, soʻng <b className="text-fg">GO</b>.
        </div>
      )}

      {/* ── KPI: MIBda jami / bizniki / boshqa / summalar ───────────────── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi big icon={<Ico.layer size={18} />} label="MIBda jami ijro ishlari" value={n(totalCases)}
          hint={`${n(stats?.withCases ?? 0)} mijozda topildi`} />
        <Kpi big accent icon={<Ico.shield size={18} />} label="Bizga tegishli (8 MMT)" value={n(oursCases)}
          hint={totalCases ? `jamining ${Math.round((oursCases / totalCases) * 100)}%` : '—'} />
        <Kpi icon={<Ico.users size={18} />} label="Boshqa kreditorlar" value={n(Math.max(0, totalCases - oursCases))}
          hint="davlat boji / bank / boshqa" />
        <Kpi icon={<Ico.check size={18} />} label="Tekshirildi" value={`${n(checked)} / ${n(report.total)}`}
          hint={`${n(stats?.status.PENDING ?? 0)} navbatda · ${n(stats?.status.FAILED ?? 0)} xato`} />
        <Kpi wide label="Qoldiq qarz — jami (soʻm)" value={som(stats?.totalRemainingDebt ?? 0)} icon={<Ico.receipt size={18} />} />
        <Kpi wide accent label="shundan bizning qoldiq qarz (soʻm)" value={som(oursDebt)} icon={<Ico.receipt size={18} />} />
      </div>

      {built && !pulled && !report.autoRun && (
        <div className="rounded-xl border border-dashed border-line bg-surface-2/40 px-4 py-3 text-sm text-muted">
          Ijro ishlari hali mib.uz dan tortilmagan. <b className="text-fg">GO</b> bosilsa har mijoz ketma-ket tekshiriladi —
          region / hudud / bank kesimlari va summalar shundan keyin toʻladi.
        </div>
      )}

      {/* ── filters ─────────────────────────────────────────────────────── */}
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
          <button
            onClick={() => setF({ ours: !filters.ours })}
            className={cx('h-[42px] shrink-0 rounded-xl border px-3 text-sm font-medium transition-colors',
              filters.ours ? 'border-brand-500 bg-brand-500/10 text-brand-700 dark:text-brand-300' : 'border-line text-muted hover:bg-surface-2 hover:text-fg')}
          >
            <Ico.shield size={15} className="mr-1 inline" /> Faqat bizniki
          </button>
          {anyFilter && <button className="btn-ghost h-[42px] shrink-0 text-xs" onClick={() => setFilters(emptyFilters)}><Ico.close size={14} /> Tozalash</button>}
        </div>
      </div>

      {/* ── breakdown (kesim) ───────────────────────────────────────────── */}
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <span className="mr-1 text-sm font-semibold">Kesim:</span>
            {DIMS.map((d) => (
              <button key={d.key} onClick={() => setDim(d.key)}
                className={cx('rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
                  dim === d.key ? 'bg-brand-500/12 text-brand-700 dark:text-brand-300' : 'text-muted hover:bg-surface-2 hover:text-fg')}>
                {d.label}
              </button>
            ))}
          </div>
          <span className="text-xs text-muted">{n(breakdown.length)} ta guruh</span>
        </div>
        {breakdown.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted">Maʼlumot yoʻq — GO bosib tekshiring yoki filtrni oʻzgartiring.</p>
        ) : (
          <div className="max-h-[260px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-surface text-xs uppercase tracking-wide text-muted">
                <tr className="border-b border-line">
                  <th className="px-3 py-2 text-left">{DIMS.find((d) => d.key === dim)?.label}</th>
                  <th className="px-3 py-2 text-right">Ijro ishi</th>
                  <th className="px-3 py-2 text-right">Bizniki</th>
                  <th className="px-3 py-2 text-right">Mijoz</th>
                  <th className="px-3 py-2 text-right">Qoldiq qarz</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map((r) => {
                  const active =
                    (dim === 'region' && filters.region === r.label) || (dim === 'hudud' && filters.dept === r.label) ||
                    (dim === 'bank' && filters.bank === r.label) || (dim === 'firma' && filters.firm === r.label);
                  const clickable = dim !== 'firma' || opts.firms.some(([f]) => f === r.label);
                  return (
                    <tr key={r.label}
                      onClick={() => {
                        if (dim === 'region') setF({ region: active ? '' : r.label });
                        else if (dim === 'hudud') setF({ dept: active ? '' : r.label });
                        else if (dim === 'bank') setF({ bank: active ? '' : r.label });
                        else if (clickable) setF({ firm: active ? '' : r.label });
                      }}
                      className={cx('border-b border-line/60 transition-colors', clickable && 'cursor-pointer hover:bg-surface-2', active && 'bg-brand-500/10')}>
                      <td className="px-3 py-2"><span className="line-clamp-1">{r.label}</span></td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{n(r.cases)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.ours ? <span className="text-emerald-600 dark:text-emerald-300">{n(r.ours)}</span> : <span className="text-muted">0</span>}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{n(r.clients)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{som(r.debt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── clients table ───────────────────────────────────────────────── */}
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2.5">
          <div className="text-sm">
            <span className="font-semibold">{n(fsum.clients)}</span> <span className="text-muted">mijoz{anyFilter ? ' (filtrlangan)' : ''}</span>
            <span className="text-muted"> · </span><span className="tabular-nums font-medium">{n(fsum.cases)}</span> <span className="text-muted">ijro ishi</span>
            {fsum.ours > 0 && <><span className="text-muted"> · </span><span className="tabular-nums font-medium text-emerald-600 dark:text-emerald-300">{n(fsum.ours)}</span> <span className="text-muted">bizniki</span></>}
            <span className="text-muted"> · qoldiq </span><span className="tabular-nums font-medium">{som(fsum.debt)}</span>
          </div>
          {report.autoRun && <span className="flex items-center gap-1.5 text-xs text-muted"><Spinner size={12} /> jonli</span>}
        </div>
        <div className="max-h-[46vh] overflow-auto">
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
                  onClick={() => c.caseCount > 0 && setDetailId(c.id)}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5 font-medium tabular-nums">
                      {c.caseCount > 0 && <Ico.eye size={13} className="shrink-0 text-brand-500" />}{c.pinfl}
                    </div>
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
        {/* pagination */}
        {filtered.length > 0 && (
          <Pager page={pageClamped} totalPages={totalPages} total={filtered.length} pageSize={pageSize}
            onPage={setPage} onPageSize={setPageSize} />
        )}
      </div>

      {/* per-client detail */}
      {(() => {
        const dc = detailId != null ? clients.find((c) => c.id === detailId) ?? null : null;
        return (
          <Modal open={!!dc} onClose={() => setDetailId(null)} size="xl"
            title={dc ? `${dc.pinfl} — ${dc.cases.length} ijro ishi` : ''}
            description={dc?.firm ? `Firma (konveyer): ${dc.firm}` : undefined}>
            {dc && <ClientDetail client={dc} hasDetail={dc.cases.some((k) => k.detailFetchedAt)} />}
          </Modal>
        );
      })()}
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

function FilterSelect({ label, value, onChange, options, wide }: { label: string; value: string; onChange: (v: string) => void; options: [string, number][]; wide?: boolean }) {
  return (
    <label className={cx('shrink-0', wide ? 'w-[210px]' : 'w-[160px]')}>
      <span className="field-label">{label}</span>
      <select className="field-input" value={value} onChange={(e) => onChange(e.target.value)} disabled={options.length === 0}>
        <option value="">Barchasi{options.length ? ` (${options.length})` : ''}</option>
        {options.map(([v, c]) => <option key={v} value={v}>{v.length > 34 ? v.slice(0, 33) + '…' : v} · {c}</option>)}
      </select>
    </label>
  );
}

function Pager({ page, totalPages, total, pageSize, onPage, onPageSize }: { page: number; totalPages: number; total: number; pageSize: number; onPage: (p: number) => void; onPageSize: (s: number) => void }) {
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  // Oyna: joriy sahifa atrofidan 5 ta raqam + chekka sahifalar.
  const nums: (number | '…')[] = [];
  const add = (x: number | '…') => nums.push(x);
  const win = new Set<number>([1, totalPages, page, page - 1, page + 1, page - 2, page + 2]);
  let prev = 0;
  for (let i = 1; i <= totalPages; i++) {
    if (!win.has(i)) continue;
    if (i - prev > 1) add('…');
    add(i); prev = i;
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
        <button className="grid h-8 w-8 place-items-center rounded-lg border border-line text-muted transition-colors hover:bg-surface-2 disabled:opacity-40" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Oldingi">
          <Ico.chevron size={16} className="rotate-180" />
        </button>
        {nums.map((x, i) => x === '…'
          ? <span key={`d${i}`} className="px-1 text-muted">…</span>
          : <button key={x} onClick={() => onPage(x)} aria-current={x === page}
              className={cx('h-8 min-w-8 rounded-lg px-2 text-sm tabular-nums transition-colors', x === page ? 'bg-brand-500 text-white' : 'border border-line text-muted hover:bg-surface-2')}>{x}</button>)}
        <button className="grid h-8 w-8 place-items-center rounded-lg border border-line text-muted transition-colors hover:bg-surface-2 disabled:opacity-40" disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label="Keyingi">
          <Ico.chevron size={16} />
        </button>
      </div>
    </div>
  );
}
