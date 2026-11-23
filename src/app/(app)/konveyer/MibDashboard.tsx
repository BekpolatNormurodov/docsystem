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
import { BASE_PATH } from '@/lib/base-path';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Ico, Spinner, DateField, useConfirm } from '@/ui';
import { type ClientRow } from '../mib-hisoboti/MibClientDetail';
import { ClientDetailFull } from '../mib-hisoboti/ClientDetailFull';
import { MibLogPanel } from '../mib-hisoboti/MibLogPanel';
import { regionOf, groupBreakdown, parseMoney, clean, shortFirm, normalizeBank, isPostalFee, UNKNOWN, OTHER_FIRM, type Dim } from '@/lib/mib/breakdown';
import { MIB_COMPANIES } from '@/lib/mib/companies';
import { useT } from '@/lib/i18n/client';
import { RecheckModal, type RecheckInfo } from '../mib-hisoboti/RecheckModal';

interface Report { id: number; createdAt: string; label: string | null; total: number; autoRun: boolean; statusFilter: string | null; sourceFileName?: string }
interface Stats {
  total: number; status: Record<string, number>; withCases: number; totalCases: number; detailedCases: number;
  totalRemainingDebt: number; ourRemainingDebt?: number; firms: { name: string; inn: string; cases: number; clients: number; remainingDebt: number }[];
}

interface HealthCheck { key: 'site' | 'session' | 'form' | 'sms'; ok: boolean; warn?: boolean; ms?: number; detail: string }
interface Health { ok: boolean; baseUrl: string; checks: HealthCheck[]; lastSmsAt: string | null; checkedAt: string; error?: string }
const HEALTH_LABEL: Record<HealthCheck['key'], string> = { site: 'mib.uz sayti', session: 'Sessiya', form: 'Qidiruv formasi', sms: 'SMS raqami' };

const cx = (...c: (string | false | undefined | null)[]) => c.filter(Boolean).join(' ');
const n = (x: number) => (x || 0).toLocaleString('ru-RU');
const som = (x: number) => (x || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 });

async function jget(url: string) { const r = await fetch(url, { cache: 'no-store' }); return r.json().catch(() => ({})); }
async function jpost(url: string, body?: unknown) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { ok: r.ok, status: r.status, json: await r.json().catch(() => ({})) };
}

interface Enriched extends ClientRow {
  region2: string;
  depts: string[];
  banks: string[];
  judges: string[];
  ourFirms: string[];
  firmKeys: string[];
  ours: boolean;
  remainingSum: number;
  caseCount: number;
  hay: string;
}
function enrich(c: ClientRow): Enriched {
  // depts/banks/firmKeys — breakdown rowKey bilan BIR XIL (bo'sh → «Aniqlanmagan»), aks holda kesim
  // qatorini bosганда filtr mos kelmay «Filtrga mos mijoz yo'q» chiqardi (2026-09-17). ourFirms — faqat
  // bizniki (dropdown + «bizniki» belgisi uchun); firmKeys — HAMMA kesim yorlig'i (kesimni bosish uchun).
  const depts = new Set<string>(), banks = new Set<string>(), judges = new Set<string>(), ourFirms = new Set<string>(), firmKeys = new Set<string>();
  let remainingSum = 0, ours = false;
  for (const k of c.cases) {
    depts.add(clean(k.executorDept) || UNKNOWN);
    banks.add(normalizeBank(k.bankName) || UNKNOWN);
    judges.add(clean(k.judge) || UNKNOWN);
    firmKeys.add(k.firmName ? shortFirm(k.firmName) : OTHER_FIRM);
    if (k.isTargetFirm && k.firmName) { ours = true; ourFirms.add(shortFirm(k.firmName)); }
    remainingSum += parseMoney(k.remainingDebt);
  }
  const hay = [c.pinfl, c.fio2, c.fio, c.firm, c.ishRaqami, ...c.cases.map((k) => k.workNumber)].filter(Boolean).join(' ').toLowerCase();
  return { ...c, region2: regionOf(c) ?? UNKNOWN, depts: [...depts], banks: [...banks], judges: [...judges], ourFirms: [...ourFirms], firmKeys: [...firmKeys], ours, remainingSum, caseCount: c.cases.length, hay };
}

type Tab = 'mijozlar' | Dim;
// Kesim (region/hudud/sudya/bank/firma) OLDINDA — default «Region»; «Mijozlar» ro'yxati oxirida.
const TABS: { key: Tab; label: string }[] = [
  { key: 'region', label: 'Region' }, { key: 'hudud', label: 'Hudud (MIB)' }, { key: 'sudya', label: 'Sudya' },
  { key: 'bank', label: 'Bank' }, { key: 'firma', label: 'Firma' }, { key: 'mijozlar', label: 'Mijozlar' },
];
const PAGE_SIZES = [25, 50, 100];
type Own = 'all' | 'ours' | 'others'; // Hammasi / Bizga tegishli / Bizga tegishli emas
// Ish turi: qarz ijrolari (default) / pochta xarajati (20 600 / 22 000 so'm) / hammasi.
type Kind = 'debt' | 'postal' | 'all';
const emptyFilters = { q: '', region: '', dept: '', judge: '', bank: '', firm: '', own: 'all' as Own, kind: 'debt' as Kind };
// Firma filtri — doim BIZNING barcha firmalarimiz (ishi bo'lmasa ham, 0 bilan).
const OUR_FIRMS = MIB_COMPANIES.map((c) => shortFirm(c.name));
type Filters = typeof emptyFilters;
// Kesim tabi → uni filtrlaydigan maydon (kesim qatorini bosganda).
const FILTER_KEY: Record<Dim, 'region' | 'dept' | 'judge' | 'bank' | 'firm'> = { region: 'region', hudud: 'dept', sudya: 'judge', bank: 'bank', firma: 'firm' };

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
  const t = useT();
  const router = useRouter();
  const confirm = useConfirm();
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
  // Reused PINFL — modal (window.confirm o'rniga)
  const [reusedInfo, setReusedInfo] = useState<(RecheckInfo & { clientId: number }) | null>(null);
  // Avtomator o'zi pauza qilgan bo'lsa (ulanish uzildi) — sababi; «Ulanishni tekshirish» natijasi.
  const [halt, setHalt] = useState<{ at: number; reason: string } | null>(null);
  const [health, setHealth] = useState<Health | null>(null);

  const load = useCallback(async () => {
    const j = await jget(aggregate ? `${BASE_PATH}/api/mib/all` : `${BASE_PATH}/api/mib/${reportId}`);
    setReport(j.report ?? null); setClients(j.clients ?? []); setStats(j.stats ?? null);
    setHolatValues(j.holatValues ?? []);
    setSentRange(j.sentDateRange ?? { min: null, max: null });
    setHalt(j.halt ?? null);
    if (j.report?.statusFilter != null) setStatusFilter(j.report.statusFilter);
  }, [reportId, aggregate]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!report?.autoRun) return;
    const t = setInterval(() => void load(), 3500);
    return () => clearInterval(t);
  }, [report?.autoRun, load]);

  // Pochta xarajati ijrolari qarz ijrolaridan AJRATILADI — ish turi filtri barcha kesim/summalarga
  // case darajasida qo'llanadi. Ishsiz (toza) mijozlar faqat «Qarz»/«Hammasi»da qoladi.
  const postal = useMemo(() => {
    let cases = 0, ours = 0, debt = 0; const cl = new Set<number>();
    for (const c of clients) for (const k of c.cases) if (isPostalFee(k)) { cases += 1; cl.add(c.id); debt += parseMoney(k.remainingDebt); if (k.isTargetFirm) ours += 1; }
    return { cases, ours, clients: cl.size, debt };
  }, [clients]);
  const kindClients = useMemo(() => {
    if (filters.kind === 'all') return clients;
    const want = filters.kind === 'postal';
    return clients
      .map((c) => ({ ...c, cases: c.cases.filter((k) => isPostalFee(k) === want) }))
      .filter((c, i) => c.cases.length > 0 || (!want && clients[i]!.cases.length === 0));
  }, [clients, filters.kind]);
  const enriched = useMemo(() => kindClients.map(enrich), [kindClients]);

  const opts = useMemo(() => {
    const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
    const R = new Map<string, number>(), D = new Map<string, number>(), J = new Map<string, number>(), B = new Map<string, number>(), F = new Map<string, number>(OUR_FIRMS.map((f) => [f, 0]));
    for (const c of enriched) {
      if (c.region2) bump(R, c.region2);
      for (const d of c.depts) bump(D, d);
      for (const j of c.judges) bump(J, j);
      for (const b of c.banks) bump(B, b);
      for (const f of c.ourFirms) bump(F, f);
    }
    const sort = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return { regions: sort(R), depts: sort(D), judges: sort(J), banks: sort(B), firms: sort(F) };
  }, [enriched]);

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return enriched.filter((c) =>
      (!q || c.hay.includes(q)) &&
      (!filters.region || c.region2 === filters.region) &&
      (!filters.dept || c.depts.includes(filters.dept)) &&
      (!filters.judge || c.judges.includes(filters.judge)) &&
      (!filters.bank || c.banks.includes(filters.bank)) &&
      (!filters.firm || c.firmKeys.includes(filters.firm)) &&
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
  const oursDebt = stats ? (stats.ourRemainingDebt ?? stats.firms.reduce((s, f) => s + f.remainingDebt, 0)) : 0;
  const totalCases = stats?.totalCases ?? 0;
  const checked = (stats?.status.DONE ?? 0) + (stats?.status.CLEAN ?? 0);
  const failedCount = stats?.status.FAILED ?? 0;
  // Xato sabablari (eng ko'pi tepada) — nima uchun osilib qolganini ko'rsatish uchun. Xabardagi
  // o'zgaruvchan qismlar (URL, raqamlar) bir guruhga tushsin deb soddalashtiriladi.
  const failReasons = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of clients) {
      if (c.status !== 'FAILED') continue;
      const key = (c.error || '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').replace(/[:\s]+$/, '').trim().slice(0, 140) || '—';
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [clients]);
  const built = (report?.total ?? 0) > 0;
  const pulled = totalCases > 0 || (stats?.detailedCases ?? 0) > 0;
  // «Qo'lda tekshiruvlar» (Excelsiz) — Excel «Holat» / «Ro'yxatni qurish» ko'rsatilmaydi.
  const isManual = (report?.sourceFileName ?? '').startsWith('manual:') || (holatValues.length === 0 && (report?.statusFilter ?? '') === 'Qoʻlda');

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageClamped = Math.min(page, totalPages);
  const pageRows = filtered.slice((pageClamped - 1) * pageSize, pageClamped * pageSize);

  const anyFilter = !!(filters.q || filters.region || filters.dept || filters.judge || filters.bank || filters.firm || filters.own !== 'all' || filters.kind !== 'debt');
  const setF = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const jumpFilter = (dim: Dim, label: string) => {
    const key = FILTER_KEY[dim];
    setF({ [key]: filters[key] === label ? '' : label } as Partial<Filters>);
    setTab('mijozlar');
  };
  // Standalone — alohida to'liq sahifa; konveyer modal — ichki ko'rinish.
  const openClient = (cid: number) => { if (clientHrefBase) router.push(`${clientHrefBase}/${cid}`); else setDetailId(cid); };

  // controls
  const build = async () => {
    setBusy('build'); setNote('');
    const body = { statusFilter: statusFilter || null, dateFrom: dateFrom || null, dateTo: dateTo || null };
    let { ok, json } = await jpost(`${BASE_PATH}/api/mib/${reportId}/build`, body);
    // Tekshirilgan natijalar bor — o'chishini aniq aytib tasdiq so'raymiz (tasodifiy bosish ma'lumotni o'chirmasin).
    if (!ok && json?.needConfirm) {
      const yes = await confirm({
        title: t('Roʻyxatni qayta qurish'),
        description: `${n(json.checked)} ${t('ta mijoz allaqachon tekshirilgan. Qayta qursangiz ularning ijro ishlari va detallari OʻCHADI va qaytadan tortiladi. Davom etilsinmi?')}`,
        confirmLabel: t('Ha, qayta qurish'), danger: true,
      });
      if (!yes) { setBusy(''); return; }
      ({ ok, json } = await jpost(`${BASE_PATH}/api/mib/${reportId}/build`, { ...body, force: true }));
    }
    if (!ok) setNote(json.error || t('Xatolik')); else { await load(); await onChanged?.(); }
    setBusy('');
  };
  const go = async () => {
    setBusy('go'); setNote('');
    const { ok, json } = await jpost(`${BASE_PATH}/api/mib/${reportId}/run`);
    if (!ok) { setNote(json.error || t('Xatolik')); setBusy(''); return; }
    if (!json.phoneConfigured) setNote(t('Diqqat: telefon raqami sozlanmagan — chuqur detal (SMS) olinmaydi, faqat ijro ishlari roʻyxati.'));
    await load(); await onChanged?.(); setBusy('');
  };
  // «Xatolarni davom ettirish» — FAILED mijozlar qayta navbatga (PENDING) qo'yilib, run davom etadi.
  const retryFailed = async () => {
    const yes = await confirm({
      title: t('Xatolarni davom ettirish'),
      description: `${n(failedCount)} ${t('ta «xato» mijoz qayta navbatga qoʻyiladi va tekshirish shu joydan davom etadi. Avval «Ulanishni tekshirish» bilan mib.uz ishlayotganiga ishonch hosil qiling.')}`,
      confirmLabel: t('Ha, davom ettirish'),
    });
    if (!yes) return;
    setBusy('retry'); setNote('');
    const { ok, json } = await jpost(`${BASE_PATH}/api/mib/${reportId}/run`, { retryFailed: true });
    if (!ok) setNote(json.error || t('Xatolik'));
    else if (!json.phoneConfigured) setNote(t('Diqqat: telefon raqami sozlanmagan — chuqur detal (SMS) olinmaydi, faqat ijro ishlari roʻyxati.'));
    await load(); await onChanged?.(); setBusy('');
  };
  // «Ulanishni tekshirish» — server mib.uz'ga yeta oladimi (sayt → sessiya → qidiruv formasi → SMS raqami).
  const checkHealth = async () => {
    setBusy('health');
    try {
      const r = await fetch(`${BASE_PATH}/api/mib/health`, { cache: 'no-store' });
      const j = await r.json().catch(() => null);
      setHealth(j?.checks ? j : { ok: false, baseUrl: '', checks: [], lastSmsAt: null, checkedAt: new Date().toISOString(), error: j?.error || `HTTP ${r.status}` });
    } catch (e) {
      setHealth({ ok: false, baseUrl: '', checks: [], lastSmsAt: null, checkedAt: new Date().toISOString(), error: (e as Error).message });
    }
    setBusy('');
  };
  const stop = async () => { setBusy('stop'); await jpost(`${BASE_PATH}/api/mib/${reportId}/stop`); await load(); await onChanged?.(); setBusy(''); };
  const doReseed = async () => { setBusy('reseed'); await reseed?.(); await load(); await onChanged?.(); setBusy(''); };
  const addPinfl = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = pinfl.replace(/\D/g, '');
    if (p.length !== 14) { setAddMsg({ ok: false, text: t('PINFL 14 ta raqam boʻlishi kerak') }); return; }
    setBusy('add'); setAddMsg(null);
    const doPost = (force: boolean) => jpost(`${BASE_PATH}/api/mib/${reportId}/add-pinfl`, { pinfl: p, force });
    const { ok, json } = await doPost(false);
    setBusy('');
    if (!ok) { setAddMsg({ ok: false, text: json.error || t('Xatolik') }); return; }
    if (json.reused) {
      // Modal ochamiz — foydalanuvchi tanlagunча boshqa harakat qilmaymiz.
      setReusedInfo({ pinfl: p, lastCheckedAt: json.lastCheckedAt, cases: json.cases, clientId: json.clientId });
      return;
    }
    setPinfl(''); setAddMsg({ ok: true, text: json.running ? `${p} ${t('qoʻshildi — tekshirilmoqda…')}` : `${p} ${t('qoʻshildi (navbatda)')}` });
    await load(); await onChanged?.();
    if (clientHrefBase && json.clientId) router.push(`${clientHrefBase}/${json.clientId}`);
  };
  const doForceReused = async () => {
    if (!reusedInfo) return;
    setBusy('add');
    const { ok, json } = await jpost(`${BASE_PATH}/api/mib/${reportId}/add-pinfl`, { pinfl: reusedInfo.pinfl, force: true });
    setBusy(''); setReusedInfo(null);
    if (!ok) { setAddMsg({ ok: false, text: json.error || t('Xatolik') }); return; }
    setPinfl(''); setAddMsg({ ok: true, text: json.running ? `${reusedInfo.pinfl} ${t('qoʻshildi — tekshirilmoqda…')}` : `${reusedInfo.pinfl} ${t('qoʻshildi (navbatda)')}` });
    await load(); await onChanged?.();
    if (clientHrefBase && (json.clientId || reusedInfo.clientId)) router.push(`${clientHrefBase}/${json.clientId || reusedInfo.clientId}`);
  };
  const doKeepOldReused = () => {
    if (!reusedInfo) return;
    const id = reusedInfo.clientId; setReusedInfo(null);
    if (clientHrefBase && id) router.push(`${clientHrefBase}/${id}`);
    else if (id) setDetailId(id);
  };

  if (!report) return <div className="grid place-items-center py-16"><Spinner /></div>;

  // ── Ichki ko'rinish (konveyer modal): mijoz detali ─────────────────────────
  if (detailId != null) return <ClientDetailFull reportId={reportId} clientId={detailId} onBack={() => setDetailId(null)} />;

  const excelHref = tab === 'mijozlar' ? `${BASE_PATH}/api/mib/${reportId}/excel` : `${BASE_PATH}/api/mib/${reportId}/excel?tab=${tab}`;

  return (
    <div className="space-y-4">
      <RecheckModal open={!!reusedInfo} info={reusedInfo} onClose={() => setReusedInfo(null)} onConfirm={doForceReused} onKeepOld={doKeepOldReused} />
      {/* ── standalone: «Holat» + sana → Ro'yxatni qurish ────────────────── */}
      {variant === 'standalone' && !report.autoRun && !isManual && !aggregate && (
        <div className="card space-y-3 p-3">
          <div>
            <span className="field-label">{t('«Holat» boʻyicha (Excel)')}</span>
            <div className="flex flex-wrap gap-2">
              <MiniChip active={statusFilter === ''} onClick={() => setStatusFilter('')}>{t('Barchasi')}</MiniChip>
              {holatValues.map((h) => (
                <MiniChip key={h.value} active={statusFilter === h.value} onClick={() => setStatusFilter(h.value)}>
                  {h.value} <span className="opacity-60">· {h.count}</span>
                </MiniChip>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-[168px]"><DateField label={t('Yuborilgan sana — dan')} value={dateFrom} onChange={setDateFrom} min={sentRange.min ?? undefined} max={sentRange.max ?? undefined} /></div>
            <div className="w-[168px]"><DateField label={t('gacha')} value={dateTo} onChange={setDateTo} min={sentRange.min ?? undefined} max={sentRange.max ?? undefined} /></div>
            {(dateFrom || dateTo) && <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => { setDateFrom(''); setDateTo(''); }}>{t('Sanani tozalash')}</button>}
            <div className="flex-1" />
            <button className="btn-ghost shrink-0" disabled={busy === 'build'} onClick={build}>{busy === 'build' ? <Spinner size={16} /> : <Ico.refresh size={16} />} {t('Roʻyxatni qurish')}</button>
          </div>
        </div>
      )}

      {/* ── control bar ─────────────────────────────────────────────────── */}
      {aggregate ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Ico.layer size={16} className="text-brand-600 dark:text-brand-400" />
          <span><b className="text-fg">{t('Umumiy')}</b> · {t('barcha hisobotlar birga')} · <b className="tabular-nums text-fg">{n(report.total)}</b> {t('ta mijoz (PINFL bo‘yicha yagona)')}</span>
          <div className="flex-1" />
          <button className="btn-ghost shrink-0" disabled={busy === 'health'} onClick={checkHealth}>{busy === 'health' ? <Spinner size={16} /> : <Ico.globe size={16} />} {t('Ulanishni tekshirish')}</button>
        </div>
      ) : (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-muted">
          {report.autoRun ? null /* jonli progress panelida (pastda) */ : (
            <span>
              {variant === 'standalone' && <b className="text-fg">{statusFilter || t('Barchasi')}</b>}{variant === 'standalone' && ' · '}
              {variant === 'konveyer' && t('Konveyerdan ')}<b className="tabular-nums text-fg">{n(report.total)}</b> {t('ta mijoz · mib.uz dan tekshiriladi')}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {reseed && !report.autoRun && (
            <button className="btn-ghost shrink-0" disabled={busy === 'reseed'} onClick={doReseed}>
              {busy === 'reseed' ? <Spinner size={16} /> : <Ico.refresh size={16} />} {t('Konveyerdan yangilash')}
            </button>
          )}
          <button className="btn-ghost shrink-0" disabled={busy === 'health'} onClick={checkHealth} title={t('Server mib.uz ga yeta oladimi: sayt → sessiya → qidiruv formasi → SMS raqami')}>
            {busy === 'health' ? <Spinner size={16} /> : <Ico.globe size={16} />} {t('Ulanishni tekshirish')}
          </button>
          {!report.autoRun && failedCount > 0 && (
            <button className="btn-ghost shrink-0 border-rose-500/40 text-rose-600 hover:bg-rose-500/10 dark:text-rose-300" disabled={busy === 'retry' || busy === 'go'} onClick={retryFailed}
              title={t('«Xato» boʻlib qolgan mijozlarni qayta navbatga qoʻyib, tekshirishni davom ettiradi')}>
              {busy === 'retry' ? <Spinner size={16} /> : <Ico.redo size={16} />} {t('Xatolarni davom ettirish')} <span className="tabular-nums opacity-80">({n(failedCount)})</span>
            </button>
          )}
          {report.autoRun ? (
            <button className="btn-danger shrink-0" disabled={busy === 'stop'} onClick={stop}>{busy === 'stop' ? <Spinner size={16} /> : <Ico.minus size={16} />} STOP</button>
          ) : (
            <button className="btn-primary shrink-0" disabled={!built || busy === 'go'} onClick={go}>{busy === 'go' ? <Spinner size={16} /> : <Ico.flash size={16} />} GO — {t('tekshirish')}</button>
          )}
        </div>
      </div>
      )}
      {note && <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-600 dark:text-amber-300">{note}</p>}
      {/* Avtomator o'zi pauza qilgan (ulanish uzildi) — mijozlar navbatda qolgan, GO davom ettiradi. */}
      {halt && !report.autoRun && !aggregate && (
        <div className="flex flex-wrap items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
          <Ico.info size={16} className="mt-0.5 shrink-0" />
          <span className="min-w-0 flex-1">{halt.reason} <span className="text-xs opacity-70">· {new Date(halt.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span></span>
          <span className="text-xs opacity-80">{t('Ulanishni tekshirib, GO bilan davom ettiring.')}</span>
        </div>
      )}
      {health && <HealthCard health={health} onClose={() => setHealth(null)} />}
      {/* Xato sabablari — nima uchun «xato» boʻlib qolgani (eng koʻpi tepada). */}
      {!aggregate && !report.autoRun && failedCount > 0 && (
        <details className="group rounded-lg border border-line bg-surface-2/30 px-3 py-2 text-sm">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-muted hover:text-fg">
            <svg className="h-4 w-4 shrink-0 transition-transform group-open:rotate-90" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 6 6 6-6 6" /></svg>
            <b className="tabular-nums text-rose-600 dark:text-rose-300">{n(failedCount)}</b> {t('ta mijoz «xato» holatida — sabablari')}
            {failReasons[0] && <span className="min-w-0 flex-1 truncate text-xs opacity-80">· {failReasons[0][0]} ({n(failReasons[0][1])})</span>}
          </summary>
          <ul className="mt-2 space-y-1">
            {failReasons.slice(0, 8).map(([reason, cnt]) => (
              <li key={reason} className="flex items-start gap-2 text-xs">
                <span className="w-14 shrink-0 text-right font-semibold tabular-nums text-rose-600 dark:text-rose-300">{n(cnt)}</span>
                <span className="min-w-0 flex-1 break-words text-muted">{reason}</span>
              </li>
            ))}
            {failReasons.length > 8 && <li className="pl-16 text-xs text-muted">… {t('yana')} {n(failReasons.length - 8)} {t('xil sabab')}</li>}
          </ul>
        </details>
      )}
      {variant === 'standalone' && !built && !report.autoRun && !aggregate && (
        <div className="rounded-xl border border-dashed border-line bg-surface-2/40 px-4 py-3 text-sm text-muted">
          {t('Excel yuklandi. Yuqorida «Holat» (masalan')} <b className="text-fg">{t('MIBda')}</b>{t(') ni tanlab')} <b className="text-fg">{t('Roʻyxatni qurish')}</b> {t('bosing, soʻng')} <b className="text-fg">GO</b>.
        </div>
      )}

      {/* ── bitta PINFL tekshirish — FAQAT konveyer modalида (standalone sahifada tepada alohida
             kartada turadi, shuning uchun bu yerda takror ko'rsatmaymiz) ────────────────── */}
      {variant === 'konveyer' && (
        <form onSubmit={addPinfl} className="card flex flex-wrap items-center gap-2 p-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-300"><Ico.qr size={16} /></span>
          <span className="text-sm font-medium">{t('Bitta PINFL tekshirish:')}</span>
          <input className="field-input w-[190px] tabular-nums tracking-[0.1em]" inputMode="numeric" maxLength={14} placeholder={t('14 raqamli PINFL')}
            value={pinfl} onChange={(e) => { setPinfl(e.target.value.replace(/\D/g, '').slice(0, 14)); setAddMsg(null); }} />
          <button type="submit" className="btn-primary shrink-0" disabled={busy === 'add' || pinfl.replace(/\D/g, '').length !== 14}>
            {busy === 'add' ? <Spinner size={16} /> : <Ico.send size={16} />} {t('Tekshirish')}
          </button>
          {addMsg && <span className={cx('text-sm', addMsg.ok ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300')}>{addMsg.text}</span>}
          <span className="ml-auto text-xs text-muted">{t('natija ijro ishlari + sana bilan shu roʻyxatga yigʻiladi')}</span>
        </form>
      )}

      {/* ── JONLI PROGRESS: autoRun bo'lganda karta ko'rinishida — progress bar + foiz + bizniki
             live + qolgan / xato. Har 3.5s poll bilan yangilanadi. Report tugagach yashiriladi. */}
      {report.autoRun && (
        <LiveProgressCard
          checked={checked}
          total={report.total}
          pending={stats?.status.PENDING ?? 0}
          running={stats?.status.RUNNING ?? 0}
          failed={stats?.status.FAILED ?? 0}
          oursCases={oursCases}
          totalCases={totalCases}
          onStop={stop}
          busyStop={busy === 'stop'}
        />
      )}

      {/* ── KPI: MIBda jami / bizniki / summalar ─────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi big icon={<Ico.layer size={18} />} label={t('MIBda jami ijro ishlari')} value={n(totalCases)} hint={`${n(stats?.withCases ?? 0)} ${t('mijozda topildi')}`} />
        <Kpi big accent icon={<Ico.shield size={18} />} label={`${t('Bizga tegishli')} (${OUR_FIRMS.length} MMT)`} value={n(oursCases)} hint={totalCases ? `${t('jamining')} ${Math.round((oursCases / totalCases) * 100)}% · ${t('shundan pochta xarajati')} ${n(postal.ours)}` : '—'} />
        <Kpi icon={<Ico.users size={18} />} label={t('Boshqa kreditorlar')} value={n(Math.max(0, totalCases - oursCases))} hint={t('davlat boji / bank / boshqa')} />
        <Kpi icon={<Ico.check size={18} />} label={t('Tekshirildi')} value={`${n(checked)} / ${n(report.total)}`} hint={`${n(stats?.status.PENDING ?? 0)} ${t('navbatda')} · ${n(stats?.status.FAILED ?? 0)} ${t('xato')}`} />
        <Kpi wide label={t('Qoldiq qarz — jami (soʻm)')} value={som(stats?.totalRemainingDebt ?? 0)} icon={<Ico.receipt size={18} />} />
        <Kpi wide accent label={t('shundan bizning qoldiq qarz (soʻm)')} value={som(oursDebt)} icon={<Ico.receipt size={18} />} />
      </div>

      {built && !pulled && !report.autoRun && (
        <div className="rounded-xl border border-dashed border-line bg-surface-2/40 px-4 py-3 text-sm text-muted">
          {t('Ijro ishlari hali mib.uz dan tortilmagan.')} <b className="text-fg">GO</b> {t('bosilsa har mijoz ketma-ket tekshiriladi — region / hudud / bank kesimlari va summalar shundan keyin toʻladi.')}
        </div>
      )}

      {/* ── filters (hamma tab uchun umumiy) ─────────────────────────────── */}
      <div className="card p-3">
        <div className="flex flex-wrap items-end gap-2.5">
          <label className="min-w-[190px] flex-1">
            <span className="field-label">{t('Qidiruv (PINFL / F.I.O / ish №)')}</span>
            <input className="field-input" value={filters.q} onChange={(e) => setF({ q: e.target.value })} placeholder={t('qidirish…')} />
          </label>
          <FilterSelect label={t('Region')} value={filters.region} onChange={(v) => setF({ region: v })} options={opts.regions} />
          <FilterSelect label={t('Hudud (MIB boʻlimi)')} value={filters.dept} onChange={(v) => setF({ dept: v })} options={opts.depts} wide />
          <FilterSelect label={t('Sudya')} value={filters.judge} onChange={(v) => setF({ judge: v })} options={opts.judges} wide />
          <FilterSelect label={t('Bank')} value={filters.bank} onChange={(v) => setF({ bank: v })} options={opts.banks} wide />
          <FilterSelect label={t('Firma')} value={filters.firm} onChange={(v) => setF({ firm: v })} options={opts.firms} />
          <div className="shrink-0">
            <span className="field-label">{t('Tegishlilik')}</span>
            <div className="flex h-[42px] items-center gap-0.5 rounded-xl border border-line p-0.5">
              {([['all', 'Hammasi'], ['ours', 'Bizniki'], ['others', 'Tegishli emas']] as [Own, string][]).map(([v, lbl]) => (
                <button key={v} onClick={() => setF({ own: v })}
                  className={cx('rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors', filters.own === v ? 'bg-brand-500 text-white shadow-sm' : 'text-muted hover:text-fg')}>
                  {t(lbl)}
                </button>
              ))}
            </div>
          </div>
          <div className="shrink-0">
            <span className="field-label">{t('Ish turi')}</span>
            <div className="flex h-[42px] items-center gap-0.5 rounded-xl border border-line p-0.5">
              {([['debt', 'Qarz ijrolari', totalCases - postal.cases], ['postal', 'Pochta xarajati', postal.cases], ['all', 'Hammasi', totalCases]] as [Kind, string, number][]).map(([v, lbl, cnt]) => (
                <button key={v} onClick={() => setF({ kind: v })} title={v === 'postal' ? t('20 600 / 22 000 soʻmlik pochta xarajati ijrolari') : undefined}
                  className={cx('rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors', filters.kind === v ? 'bg-brand-500 text-white shadow-sm' : 'text-muted hover:text-fg')}>
                  {t(lbl)} <span className="tabular-nums opacity-70">{n(cnt)}</span>
                </button>
              ))}
            </div>
          </div>
          {anyFilter && <button className="btn-ghost h-[42px] shrink-0 self-end text-xs" onClick={() => setFilters(emptyFilters)}><Ico.close size={14} /> {t('Tozalash')}</button>}
        </div>
      </div>

      {/* ── tabs + Excel ─────────────────────────────────────────────────── */}
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-2 py-2">
          <div className="flex flex-wrap items-center gap-1">
            {TABS.map((tb) => (
              <button key={tb.key} onClick={() => setTab(tb.key)}
                className={cx('rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  tab === tb.key ? 'bg-brand-500/10 text-brand-700 dark:text-brand-300' : 'text-muted hover:bg-surface-2 hover:text-fg')}>
                {t(tb.label)}
              </button>
            ))}
          </div>
          {!aggregate && (
            <div className="mr-1 flex shrink-0 items-center gap-1">
              {/* «To'liq Excel» — DOIM hamma varaq (Mijozlar + Ishlar + Ijrochilar + Firma/Region/Hudud/Bank).
                  «Faqat shu kesim» — kesim tablarда qulaylik uchun bitta varaq. */}
              <a className="btn-ghost text-xs" href={`${BASE_PATH}/api/mib/${reportId}/excel`}><Ico.download size={14} /> {t('Toʻliq Excel')}</a>
              {tab !== 'mijozlar' && <a className="btn-ghost text-xs" href={excelHref}>{t('Faqat shu kesim')}</a>}
            </div>
          )}
        </div>

        {/* summary line for the active view */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-2/30 px-3 py-2 text-sm">
          <div>
            <span className="font-semibold">{n(fsum.clients)}</span> <span className="text-muted">{t('mijoz')}{anyFilter ? t(' (filtrlangan)') : ''}</span>
            <span className="text-muted"> · </span><span className="tabular-nums font-medium">{n(fsum.cases)}</span> <span className="text-muted">{t('ijro ishi')}</span>
            {fsum.ours > 0 && <><span className="text-muted"> · </span><span className="tabular-nums font-medium text-emerald-600 dark:text-emerald-300">{n(fsum.ours)}</span> <span className="text-muted">{t('bizniki')}</span></>}
            <span className="text-muted"> · {t('qoldiq')} </span><span className="tabular-nums font-medium">{som(fsum.debt)}</span>
          </div>
          {tab !== 'mijozlar' && <span className="text-xs text-muted">{n(breakdown.length)} {t('ta guruh · qatordan bosib filtrlang')}</span>}
          {tab === 'mijozlar' && report.autoRun && <span className="flex items-center gap-1.5 text-xs text-muted"><Spinner size={12} /> {t('jonli')}</span>}
        </div>

        {tab === 'mijozlar' ? (
          <>
            <div className="max-h-[52vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-surface text-xs uppercase tracking-wide text-muted">
                  <tr className="border-b border-line">
                    <th className="px-3 py-2 text-left">{t('PINFL / F.I.O')}</th>
                    <th className="px-3 py-2 text-left">{t('Firma')}</th>
                    <th className="px-3 py-2 text-left">{t('Hudud (MIB)')}</th>
                    <th className="px-3 py-2 text-left">{t('Bank')}</th>
                    <th className="px-3 py-2 text-right">{t('Ijro')}</th>
                    <th className="px-3 py-2 text-right">{t('Qoldiq qarz')}</th>
                    <th className="px-3 py-2 text-center">{t('Holati')}</th>
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
                          {c.status === 'RUNNING' ? <Spinner size={11} className="mr-1" /> : null}{t(STATUS_LABEL[c.status] ?? c.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {pageRows.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-muted">{anyFilter ? t('Filtрga mos mijoz yoʻq.') : t('Roʻyxat boʻsh.')}</td></tr>}
                </tbody>
              </table>
            </div>
            {filtered.length > 0 && <Pager page={pageClamped} totalPages={totalPages} total={filtered.length} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} />}
          </>
        ) : (
          <BreakdownTable rows={breakdown} dim={tab} activeLabel={filters[FILTER_KEY[tab]]} onPick={(label) => jumpFilter(tab, label)} />
        )}
      </div>

      {/* Avtomator logi — jonli (SMS, tekshiruv qadamlari, xatolar) */}
      <MibLogPanel title={t('Avtomator logi')} defaultOpen={report.autoRun} />
    </div>
  );
}


// ── breakdown table (Firma / Region / Hudud / Bank tabs) ────────────────────────
type BRow = { label: string; cases: number; clients: number; ours: number; debt: number };
function BreakdownTable({ rows, dim, activeLabel, onPick }: { rows: BRow[]; dim: Dim; activeLabel: string; onPick: (label: string) => void }) {
  const t = useT();
  const [showOthers, setShowOthers] = useState(false);
  const head = dim === 'firma' ? t('Firma') : dim === 'region' ? t('Region') : dim === 'hudud' ? t('Hudud (MIB boʻlimi)') : dim === 'sudya' ? t('Sudya') : t('Bank');
  const totals = rows.reduce((a, r) => ({ cases: a.cases + r.cases, ours: a.ours + r.ours, debt: a.debt + r.debt }), { cases: 0, ours: 0, debt: 0 });
  if (rows.length === 0) return <p className="px-4 py-10 text-center text-sm text-muted">{t('Maʼlumot yoʻq — GO bosib tekshiring yoki filtrni oʻzgartiring.')}</p>;

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
            <th className="px-3 py-2 text-right">{t('Ijro ishi')}</th>
            <th className="px-3 py-2 text-right">{t('Bizniki')}</th>
            <th className="px-3 py-2 text-right">{t('Mijoz')}</th>
            <th className="px-3 py-2 text-right">{t('Qoldiq qarz')}</th>
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
                    {t('Bizga tegishli emas')} <span className="opacity-70">({n(otherRows.length)} {t('ta')} · {n(otherTot.cases)} {t('ish')} · {t('qoldiq')} {som(otherTot.debt)})</span>
                    <span className="ml-auto text-xs opacity-60">{showOthers ? t('yopish') : t('ochish')}</span>
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
            <td className="px-3 py-2.5">{t('Jami')} · {n(rows.length)} {t('guruh')}</td>
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

// «Ulanishni tekshirish» natijasi — har bosqich alohida (qaysi joyda uzilgani ko'rinsin).
function HealthCard({ health, onClose }: { health: Health; onClose: () => void }) {
  const t = useT();
  const tone = health.ok ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-rose-500/30 bg-rose-500/5';
  return (
    <div className={cx('rounded-lg border px-3 py-2.5 text-sm', tone)}>
      <div className="flex items-center gap-2">
        <span className={cx('h-2.5 w-2.5 shrink-0 rounded-full', health.ok ? 'bg-emerald-500' : 'bg-rose-500')} />
        <b className={health.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}>
          {health.ok ? t('Ulanish joyida — mib.uz ishlayapti') : t('Ulanishda muammo bor')}
        </b>
        <span className="truncate text-xs text-muted">{health.baseUrl} · {new Date(health.checkedAt).toLocaleTimeString('ru-RU')}</span>
        <button className="ml-auto shrink-0 text-muted hover:text-fg" onClick={onClose} aria-label={t('Yopish')}><Ico.close size={16} /></button>
      </div>
      {health.error && <p className="mt-1.5 text-xs text-rose-700 dark:text-rose-300">{health.error}</p>}
      {health.checks.length > 0 && (
        <div className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
          {health.checks.map((c) => (
            <div key={c.key} className="rounded-lg border border-line bg-surface px-2.5 py-1.5">
              <div className="flex items-center gap-1.5 text-xs font-medium">
                <span className={cx('h-2 w-2 shrink-0 rounded-full', !c.ok ? 'bg-rose-500' : c.warn ? 'bg-amber-500' : 'bg-emerald-500')} />
                {t(HEALTH_LABEL[c.key])}
                {c.ms != null && <span className="ml-auto tabular-nums text-muted">{n(c.ms)} ms</span>}
              </div>
              <div className={cx('mt-0.5 break-words text-[11px]', c.ok ? 'text-muted' : 'text-rose-700 dark:text-rose-300')}>{t(c.detail)}</div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-1.5 text-[11px] text-muted">
        {t('Oxirgi SMS')}: {health.lastSmsAt ? new Date(health.lastSmsAt).toLocaleString('ru-RU') : t('hali kelmagan')}
      </div>
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
      {icon && <span className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-xl', accent ? 'bg-brand-500/10 text-brand-600 dark:text-brand-300' : 'bg-surface-2 text-muted')}>{icon}</span>}
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
  const t = useT();
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
      <span className="min-w-0 flex-1 truncate">{v || t('Barchasi')}</span>
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
          {value || <>{t('Barchasi')}{options.length ? <span className="opacity-70"> ({options.length})</span> : null}</>}
        </span>
        <svg className={cx('h-4 w-4 shrink-0 text-muted transition-transform', open && 'rotate-180')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {open && (
        <div role="listbox" className="absolute left-0 right-0 z-50 mt-1.5 rounded-xl border border-line bg-surface p-1 shadow-2xl">
          {options.length > 6 && (
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('qidirish…')}
              className="mb-1 w-full rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-sm outline-none focus:border-brand-500" />
          )}
          <div className="max-h-64 overflow-auto">
            <Row v="" active={!value} />
            {shown.map(([v, c]) => <Row key={v} v={v} c={c} active={value === v} />)}
            {shown.length === 0 && <div className="px-2 py-3 text-center text-xs text-muted">{t('Topilmadi')}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function Pager({ page, totalPages, total, pageSize, onPage, onPageSize }: { page: number; totalPages: number; total: number; pageSize: number; onPage: (p: number) => void; onPageSize: (s: number) => void }) {
  const t = useT();
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
          {PAGE_SIZES.map((s) => <option key={s} value={s}>{s} / {t('sahifa')}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-1">
        <button className="grid h-8 w-8 place-items-center rounded-lg border border-line text-muted transition-colors hover:bg-surface-2 disabled:opacity-40" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={t('Oldingi')}><Ico.chevron size={16} className="rotate-180" /></button>
        {nums.map((x, i) => x === '…'
          ? <span key={`d${i}`} className="px-1 text-muted">…</span>
          : <button key={x} onClick={() => onPage(x)} aria-current={x === page}
              className={cx('h-8 min-w-8 rounded-lg px-2 text-sm tabular-nums transition-colors', x === page ? 'bg-brand-500 text-white' : 'border border-line text-muted hover:bg-surface-2')}>{x}</button>)}
        <button className="grid h-8 w-8 place-items-center rounded-lg border border-line text-muted transition-colors hover:bg-surface-2 disabled:opacity-40" disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label={t('Keyingi')}><Ico.chevron size={16} /></button>
      </div>
    </div>
  );
}

// ── JONLI PROGRESS KARTASI — autoRun paytida, KPI'lardan oldin ko'rinadi. ─────────────────────
//    Vizual: chapdan yorqin pulsatsiyalayotgan yashil «LIVE» + katta progress bar (foiz), o'ngdan
//    STOP tugmasi. Ostida qatorda: bizniki live counter, RUNNING/PENDING/FAILED chip'lar.
function LiveProgressCard({
  checked, total, pending, running, failed, oursCases, totalCases, onStop, busyStop,
}: {
  checked: number; total: number; pending: number; running: number; failed: number;
  oursCases: number; totalCases: number; onStop: () => void; busyStop: boolean;
}) {
  const t = useT();
  const pct = total > 0 ? Math.min(100, Math.round((checked / total) * 1000) / 10) : 0;
  const remaining = Math.max(0, total - checked);
  return (
    <div className="relative overflow-hidden rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/8 via-surface to-surface p-4 shadow-sm dark:from-emerald-400/10">
      {/* animated shimmer overlay — nozik, chalg'itmaydigan */}
      <div className="pointer-events-none absolute inset-0 -z-0 opacity-40">
        <div className="absolute -left-1/3 top-0 h-full w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-emerald-400/12 to-transparent animate-[shimmer_2.4s_linear_infinite]" style={{ animationName: 'mibShimmer' }} />
      </div>
      <div className="relative flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
          </span>
          <div>
            <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">{t('Avtomator ishlayapti — jonli')}</div>
            <div className="mt-0.5 text-xs text-muted">{t('mib.uz’dan tekshirilmoqda · natija darhol saqlanadi · sahifa har 3.5 s’da yangilanadi')}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-2xl font-bold tabular-nums leading-none text-emerald-700 dark:text-emerald-300">{pct}%</div>
            <div className="mt-1 text-xs text-muted tabular-nums">{n(checked)} / {n(total)}</div>
          </div>
          <button className="btn-danger shrink-0" disabled={busyStop} onClick={onStop} title={t('Avtomatorni to‘xtatish (davom ettirsangiz shu joydan davom etadi)')}>
            {busyStop ? <Spinner size={16} /> : <Ico.minus size={16} />} STOP
          </button>
        </div>
      </div>

      {/* progress bar — animated stripes */}
      <div className="relative mt-3 h-3 overflow-hidden rounded-full bg-emerald-500/12">
        <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }}>
          <div className="h-full w-full bg-[repeating-linear-gradient(45deg,rgba(255,255,255,0.18)_0_10px,transparent_10px_20px)] animate-[stripes_1.2s_linear_infinite]" style={{ animationName: 'mibStripes' }} />
        </div>
      </div>

      {/* live chips: bizniki count + queues */}
      <div className="relative mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/8 px-2.5 py-1 font-medium text-emerald-700 dark:text-emerald-300">
          <Ico.shield size={12} /> {t('Bizniki topildi')}: <b className="tabular-nums">{n(oursCases)}</b>
          {totalCases > 0 && <span className="text-emerald-600/70">· {Math.round((oursCases / totalCases) * 100)}%</span>}
        </span>
        {running > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/8 px-2.5 py-1 text-amber-700 dark:text-amber-300">
            <Spinner size={11} /> <b className="tabular-nums">{n(running)}</b> {t('tekshirilmoqda')}
          </span>
        )}
        {pending > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-1 text-muted">
            <b className="tabular-nums">{n(pending)}</b> {t('navbatda')}
          </span>
        )}
        {failed > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/30 bg-rose-500/8 px-2.5 py-1 text-rose-700 dark:text-rose-300">
            <b className="tabular-nums">{n(failed)}</b> {t('xato')}
          </span>
        )}
        {remaining > 0 && (
          <span className="ml-auto text-muted tabular-nums">
            {t('qoldi')}: <b className="text-fg">{n(remaining)}</b>
          </span>
        )}
      </div>
      {/* keyframes — inline (Tailwind default'да yo'q) */}
      <style jsx>{`
        @keyframes mibStripes { 0% { transform: translateX(0); } 100% { transform: translateX(20px); } }
        @keyframes mibShimmer { 0% { transform: translateX(0); } 100% { transform: translateX(400%); } }
      `}</style>
    </div>
  );
}
