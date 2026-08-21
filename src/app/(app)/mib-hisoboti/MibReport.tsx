'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Ico, Spinner, useConfirm, DateField } from '@/ui';

// ── API shapes ────────────────────────────────────────────────────────────────
interface CaseRow {
  id: number; workNumber: string; firmName: string | null; isTargetFirm: boolean; courtDocNumber: string | null;
  remainingDebt: string | null; executorName: string | null; detailFetchedAt: string | null; error: string | null;
}
interface ClientRow {
  id: number; rowNo: number | null; pinfl: string; fio: string | null; firm: string | null; ishRaqami: string | null;
  holat: string | null; region: string | null; status: string; attempts: number; fio2: string | null;
  totalDebt: string | null; error: string | null; checkedAt: string | null; cases: CaseRow[];
}
interface Report {
  id: number; createdAt: string; label: string | null; sourceFileName: string; statusFilter: string | null;
  total: number; autoRun: boolean; runJobId: number | null;
}
interface ListReport extends Report { statusCounts: Record<string, number> }
interface Stats {
  total: number; status: Record<string, number>; withCases: number; totalCases: number; detailedCases: number;
  totalRemainingDebt: number; firms: { name: string; inn: string; cases: number; clients: number; remainingDebt: number }[];
}
interface HolatValue { value: string; count: number }
interface MibConfig { phone: string; baseUrl: string; intervalSec: number; webhookUrl: string }

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');
const n = (x: number) => (x || 0).toLocaleString('ru-RU');
const dt = (s: string) => new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

async function jget(url: string) { const r = await fetch(url, { cache: 'no-store' }); return r.json().catch(() => ({})); }
async function jpost(url: string, body?: unknown) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { ok: r.ok, status: r.status, json: await r.json().catch(() => ({})) };
}

export function MibReport() {
  const confirm = useConfirm();
  const [reports, setReports] = useState<ListReport[]>([]);
  const [selId, setSelId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const j = await jget('/api/mib');
    setReports(j.reports ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const anyRunning = reports.some((r) => r.autoRun);
  useEffect(() => {
    if (!anyRunning) return;
    const t = setInterval(() => void refresh(), 4000);
    return () => clearInterval(t);
  }, [anyRunning, refresh]);

  const del = async (r: ListReport) => {
    const ok = await confirm({ title: 'Hisobotni o‘chirish', description: `«${r.label || r.sourceFileName}» va uning barcha natijalari o‘chiriladi. Davom etilsinmi?`, confirmLabel: 'O‘chirish', danger: true });
    if (!ok) return;
    const res = await jpost(`/api/mib/${r.id}`);
    if (res.status === 409) { alert('Avtomator ishlayapti — avval STOP bosing'); return; }
    await fetch(`/api/mib/${r.id}`, { method: 'DELETE' });
    if (selId === r.id) setSelId(null);
    await refresh();
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">MIB hisoboti</h1>
            <span className="badge border-brand-500/30 text-brand-600 dark:text-brand-400">Alohida · stepga kirmaydi</span>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            HISOBOT Excel yuklang, «Holat» ustuni (masalan «MIBda») bo‘yicha filtrlang. GO bosilsa har ~1 daqiqada
            ketma-ket mib.uz dan tekshiradi (captcha + SMS), natijani saqlaydi. Statelar yo‘qolmaydi.
          </p>
        </div>
      </header>

      <ConfigCard />
      <UploadCard onDone={(id) => { void refresh(); setSelId(id); }} />

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <HistoryList reports={reports} loading={loading} selId={selId} onSelect={setSelId} onDelete={del} />
        {selId != null ? (
          <ReportPanel key={selId} reportId={selId} confirm={confirm} onChanged={refresh} />
        ) : (
          <div className="card grid place-items-center p-10 text-sm text-muted">Chapdan hisobotni tanlang yoki Excel yuklang.</div>
        )}
      </div>
    </div>
  );
}

// ── Config (phone / interval / webhook) ───────────────────────────────────────
// Strip the country code → national 9 digits (no live re-masking, which fought the cursor).
const toNational = (raw: string) => { const d = (raw || '').replace(/\D/g, ''); return (d.startsWith('998') ? d.slice(3) : d).slice(0, 9); };

function ConfigCard() {
  const [cfg, setCfg] = useState<MibConfig | null>(null);
  const [phone9, setPhone9] = useState(''); // national 9 digits
  const [interval, setIntervalS] = useState('60');
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const j = await jget('/api/mib/config') as MibConfig;
    setCfg(j); setPhone9(toNational(j.phone || '')); setIntervalS(String(j.intervalSec || 60));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    const full = phone9.length === 9 ? `998${phone9}` : '';
    const { json } = await jpost('/api/mib/config', { phone: full, intervalSec: Number(interval) || 60 });
    setCfg((c) => c ? { ...c, ...json } : c);
    setSaved(true); setTimeout(() => setSaved(false), 1500);
  };

  // Test the SMS pipeline: wait for a code to arrive at the webhook (operator sends a test SMS).
  const [testState, setTestState] = useState<'idle' | 'waiting' | 'ok' | 'timeout'>('idle');
  const [testCode, setTestCode] = useState('');
  const testSms = async () => {
    setTestState('waiting'); setTestCode('');
    const start = await jpost('/api/mib/test-sms');
    const baseline = Number(start.json?.baselineId) || 0;
    const deadline = Date.now() + 90_000;
    const tick = async () => {
      if (Date.now() > deadline) { setTestState('timeout'); return; }
      const r = await jget(`/api/mib/test-sms?after=${baseline}`);
      if (r?.code) { setTestCode(String(r.code)); setTestState('ok'); return; }
      setTimeout(() => { void tick(); }, 3000);
    };
    void tick();
  };

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><Ico.settings size={16} className="text-brand-600 dark:text-brand-400" /> Sozlamalar</div>
      <div className="grid gap-3 sm:grid-cols-[1fr_150px_auto] sm:items-end">
        <label>
          <span className="field-label">Telefon raqami (SMS shu raqamga keladi)</span>
          <div className="flex items-center rounded-xl border border-[var(--field-line)] bg-[var(--field)] pl-3.5 transition focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/25">
            <span className="select-none pr-2 text-sm font-medium tabular-nums text-muted">+998</span>
            <input className="w-full bg-transparent py-2.5 pr-3.5 text-sm tabular-nums tracking-[0.15em] text-fg outline-none placeholder:tracking-normal placeholder:text-muted/60" inputMode="numeric" maxLength={9} placeholder="901234567"
              value={phone9} onChange={(e) => setPhone9(e.target.value.replace(/\D/g, '').slice(0, 9))} />
          </div>
        </label>
        <label>
          <span className="field-label">Interval (sekund)</span>
          <input className="field-input tabular-nums" inputMode="numeric" value={interval} onChange={(e) => setIntervalS(e.target.value.replace(/\D/g, ''))} />
        </label>
        <button className="btn-primary shrink-0" onClick={save}>{saved ? <><Ico.check size={16} /> Saqlandi</> : 'Saqlash'}</button>
      </div>
      {cfg?.webhookUrl && (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2">
          <span className="text-xs text-muted">Webhook (Android forwarder shu manzilga POST qilsin):</span>
          <code className="flex-1 truncate text-xs">{cfg.webhookUrl}</code>
          <button className="btn-ghost px-2 py-1 text-xs" onClick={() => { navigator.clipboard?.writeText(cfg.webhookUrl); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
            {copied ? <Ico.check size={14} /> : <Ico.files size={14} />} {copied ? 'Nusxa olindi' : 'Nusxa'}
          </button>
        </div>
      )}

      {/* Test the SMS pipeline (phone → forwarder → webhook) before running the automator. */}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button className="btn-ghost" disabled={testState === 'waiting'} onClick={testSms}>
          {testState === 'waiting' ? <Spinner size={16} /> : <Ico.send size={16} />} SMS ni tekshirish
        </button>
        {testState === 'waiting' && <span className="text-sm text-amber-600 dark:text-amber-300">Telefondan test SMS yuboring — kelishi kutilmoqda…</span>}
        {testState === 'ok' && <span className="text-sm font-medium text-emerald-600 dark:text-emerald-300">✓ Tasdiqlandi — kod keldi: <b className="tabular-nums">{testCode}</b>. Telefon + webhook ishlayapti.</span>}
        {testState === 'timeout' && <span className="text-sm text-rose-600 dark:text-rose-300">⏱ 90s ichida SMS kelmadi — telefon/forwarder/webhook’ni tekshiring.</span>}
      </div>
    </div>
  );
}

// ── Upload ────────────────────────────────────────────────────────────────────
function UploadCard({ onDone }: { onDone: (id: number) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    if (!file) { setErr('Fayl tanlang'); return; }
    setErr(''); setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (label.trim()) fd.append('label', label.trim());
      const res = await fetch('/api/mib/upload', { method: 'POST', body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error || 'Xatolik'); return; }
      setFile(null); setLabel('');
      onDone(j.reportId);
    } finally { setBusy(false); }
  };

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[240px] flex-1">
          <span className="field-label">HISOBOT Excel (.xlsx)</span>
          <input ref={ref} type="file" accept=".xlsx" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <button type="button" onClick={() => ref.current?.click()} className="btn-ghost w-full justify-start">
            <Ico.sheet size={16} /><span className="truncate">{file ? file.name : 'Fayl tanlang…'}</span>
          </button>
        </div>
        <div className="min-w-[160px] flex-1">
          <span className="field-label">Nom (ixtiyoriy)</span>
          <input className="field-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="masalan: HISOBOT 120" />
        </div>
        <button className="btn-primary shrink-0" disabled={busy || !file} onClick={submit}>{busy ? <Spinner size={16} /> : <Ico.filePlus size={16} />} Yuklash</button>
      </div>
      {err && <p className="mt-2 text-sm font-medium text-rose-600 dark:text-rose-300">{err}</p>}
    </div>
  );
}

// ── History ───────────────────────────────────────────────────────────────────
function HistoryList({ reports, loading, selId, onSelect, onDelete }: { reports: ListReport[]; loading: boolean; selId: number | null; onSelect: (id: number) => void; onDelete: (r: ListReport) => void }) {
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-line px-4 py-3 text-sm font-semibold">Hisobotlar</div>
      {loading ? <div className="grid place-items-center p-8"><Spinner /></div>
        : !reports.length ? <p className="p-6 text-sm text-muted">Hali hisobot yo‘q.</p>
          : (
            <ul className="max-h-[520px] divide-y divide-line overflow-y-auto">
              {reports.map((r) => {
                const done = (r.statusCounts.DONE ?? 0) + (r.statusCounts.CLEAN ?? 0);
                return (
                  <li key={r.id} className={cx('group relative transition-colors hover:bg-surface-2', selId === r.id && 'bg-surface-2')}>
                    <button onClick={() => onSelect(r.id)} className="flex w-full flex-col gap-1 px-4 py-3 pr-10 text-left">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{r.label || r.sourceFileName}</span>
                        {r.autoRun ? <span className="badge border-emerald-500/30 text-emerald-600 dark:text-emerald-300">● ishlayapti</span>
                          : r.statusFilter ? <span className="badge border-line text-muted">{r.statusFilter}</span> : null}
                      </div>
                      <div className="text-xs text-muted">{dt(r.createdAt)}</div>
                      {r.total > 0 && <div className="text-xs text-muted">{n(done)} / {n(r.total)} tekshirildi</div>}
                    </button>
                    <button onClick={() => onDelete(r)} title="O‘chirish" className="absolute right-2 top-2.5 grid h-8 w-8 place-items-center rounded-lg text-muted opacity-0 transition-opacity hover:bg-rose-500/10 hover:text-rose-600 focus-visible:opacity-100 group-hover:opacity-100 dark:hover:text-rose-300">
                      <Ico.trash size={16} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
    </div>
  );
}

// ── Report panel ──────────────────────────────────────────────────────────────
const STATUS_STYLE: Record<string, string> = {
  PENDING: 'border-slate-400/30 text-muted', RUNNING: 'border-amber-500/30 text-amber-600 dark:text-amber-300',
  DONE: 'border-emerald-500/30 text-emerald-600 dark:text-emerald-300', CLEAN: 'border-sky-500/30 text-sky-600 dark:text-sky-300',
  FAILED: 'border-rose-500/30 text-rose-600 dark:text-rose-300',
};
const STATUS_LABEL: Record<string, string> = { PENDING: 'Navbatda', RUNNING: 'Tekshirilmoqda', DONE: 'Topildi', CLEAN: 'Toza', FAILED: 'Xato' };

function ReportPanel({ reportId, confirm, onChanged }: { reportId: number; confirm: ReturnType<typeof useConfirm>; onChanged: () => Promise<void> }) {
  const [report, setReport] = useState<Report | null>(null);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [holatValues, setHolatValues] = useState<HolatValue[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sentRange, setSentRange] = useState<{ min: string | null; max: string | null }>({ min: null, max: null });
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    const j = await jget(`/api/mib/${reportId}`);
    setReport(j.report); setClients(j.clients ?? []); setStats(j.stats ?? null); setHolatValues(j.holatValues ?? []);
    setSentRange(j.sentDateRange ?? { min: null, max: null });
    if (j.report?.statusFilter != null) setStatusFilter(j.report.statusFilter);
  }, [reportId]);
  useEffect(() => { void load(); }, [load]);

  // Poll live while running.
  useEffect(() => {
    if (!report?.autoRun) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [report?.autoRun, load]);

  if (!report) return <div className="card grid place-items-center p-10"><Spinner /></div>;

  const build = async () => {
    setBusy('build'); setNote('');
    const { ok, json } = await jpost(`/api/mib/${reportId}/build`, { statusFilter: statusFilter || null, dateFrom: dateFrom || null, dateTo: dateTo || null });
    if (!ok) setNote(json.error || 'Xatolik'); else { await load(); await onChanged(); }
    setBusy('');
  };
  const go = async () => {
    setBusy('go'); setNote('');
    const { ok, json } = await jpost(`/api/mib/${reportId}/run`);
    if (!ok) { setNote(json.error || 'Xatolik'); setBusy(''); return; }
    if (!json.phoneConfigured) setNote('Diqqat: telefon raqami sozlanmagan — chuqur detal (SMS) olinmaydi, faqat ijro ishlari ro‘yxati.');
    await load(); await onChanged(); setBusy('');
  };
  const stop = async () => {
    setBusy('stop');
    await jpost(`/api/mib/${reportId}/stop`);
    await load(); await onChanged(); setBusy('');
  };

  const built = report.total > 0;

  return (
    <div className="space-y-5">
      {/* filter + build / run controls */}
      <div className="card p-4">
        {!report.autoRun ? (
          <div className="space-y-4">
            {/* «Holat» as chips */}
            <div>
              <span className="field-label">«Holat» bo‘yicha</span>
              <div className="flex flex-wrap gap-2">
                <Chip active={statusFilter === ''} onClick={() => setStatusFilter('')}>Barchasi</Chip>
                {holatValues.map((h) => (
                  <Chip key={h.value} active={statusFilter === h.value} onClick={() => setStatusFilter(h.value)}>
                    {h.value} <span className="opacity-60">· {h.count}</span>
                  </Chip>
                ))}
              </div>
            </div>
            {/* «Yuborilgan sana» range — the app's themed date picker (ISO in/out, DD/MM/YYYY shown) */}
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-[168px]">
                <DateField label="Yuborilgan sana — dan" value={dateFrom} onChange={setDateFrom} min={sentRange.min ?? undefined} max={sentRange.max ?? undefined} />
              </div>
              <div className="w-[168px]">
                <DateField label="gacha" value={dateTo} onChange={setDateTo} min={sentRange.min ?? undefined} max={sentRange.max ?? undefined} />
              </div>
              {(dateFrom || dateTo) && <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => { setDateFrom(''); setDateTo(''); }}>Sanani tozalash</button>}
              <div className="flex-1" />
              <button className="btn-ghost shrink-0" disabled={busy === 'build'} onClick={build}>{busy === 'build' ? <Spinner size={16} /> : <Ico.refresh size={16} />} Ro‘yxatni qurish</button>
              <button className="btn-primary shrink-0" disabled={!built || busy === 'go'} onClick={go}>{busy === 'go' ? <Spinner size={16} /> : <Ico.flash size={16} />} GO — tekshirishni boshlash</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-300">
              <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" /></span>
              Avtomator ishlayapti — {statusFilter || 'barchasi'} bo‘yicha
            </span>
            <button className="btn-danger shrink-0" disabled={busy === 'stop'} onClick={stop}>{busy === 'stop' ? <Spinner size={16} /> : <Ico.minus size={16} />} STOP</button>
          </div>
        )}
        {note && <p className="mt-2 text-sm text-amber-600 dark:text-amber-300">{note}</p>}
      </div>

      {/* stats */}
      {stats && built && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            <Stat label="Jami" value={n(stats.total)} />
            <Stat label="Topildi" value={n(stats.status.DONE ?? 0)} good />
            <Stat label="Toza" value={n(stats.status.CLEAN ?? 0)} />
            <Stat label="Navbatda" value={n(stats.status.PENDING ?? 0)} />
            <Stat label="Xato" value={n(stats.status.FAILED ?? 0)} bad />
            <Stat label="Ijro ishlari" value={n(stats.totalCases)} accent />
          </div>

          {stats.firms.length > 0 && (
            <div className="card overflow-hidden">
              <div className="border-b border-line px-4 py-3 text-sm font-semibold">Firma bo‘yicha (8 ta MMT)</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase tracking-wide text-muted">
                    <tr className="border-b border-line"><th className="px-4 py-2 text-left">Firma</th><th className="px-4 py-2 text-right">Mijoz</th><th className="px-4 py-2 text-right">Ish</th><th className="px-4 py-2 text-right">Qoldiq qarz</th></tr>
                  </thead>
                  <tbody>
                    {stats.firms.map((f) => (
                      <tr key={f.inn} className="border-b border-line/60">
                        <td className="px-4 py-2.5"><div className="font-medium">{f.name.replace(/ MIKROMOLIYA.*$/i, '')}</div><div className="text-xs text-muted">INN {f.inn}</div></td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{n(f.clients)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{n(f.cases)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{n(Math.round(f.remainingDebt))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* clients monitoring table */}
      {built && (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-3 text-sm font-semibold">
            <span>Mijozlar ({n(clients.length)})</span>
            {report.autoRun && <span className="flex items-center gap-1.5 text-xs font-normal text-muted"><Spinner size={12} /> jonli yangilanmoqda</span>}
          </div>
          <div className="max-h-[560px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface text-xs uppercase tracking-wide text-muted">
                <tr className="border-b border-line">
                  <th className="px-3 py-2 text-left">#</th><th className="px-3 py-2 text-left">PINFL / F.I.O</th>
                  <th className="px-3 py-2 text-left">Firma</th><th className="px-3 py-2 text-left">Ish raqami</th>
                  <th className="px-3 py-2 text-right">Ijro</th><th className="px-3 py-2 text-center">Holati</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.id} className={cx('border-b border-line/60', c.status === 'RUNNING' && 'bg-amber-500/5')}>
                    <td className="px-3 py-2 tabular-nums text-muted">{c.rowNo ?? ''}</td>
                    <td className="px-3 py-2"><div className="font-medium tabular-nums">{c.pinfl}</div><div className="truncate text-xs text-muted">{c.fio2 || c.fio || ''}</div></td>
                    <td className="px-3 py-2 text-xs">{c.firm || ''}</td>
                    <td className="px-3 py-2 text-xs tabular-nums">{c.cases.map((k) => k.workNumber).join(', ') || c.ishRaqami || ''}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.cases.length || (c.status === 'CLEAN' ? '0' : '')}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={cx('badge', STATUS_STYLE[c.status] ?? 'border-line text-muted')}>{c.status === 'RUNNING' ? <Spinner size={11} className="mr-1" /> : null}{STATUS_LABEL[c.status] ?? c.status}</span>
                      {c.error && <div className="mt-0.5 truncate text-[10px] text-rose-500" title={c.error}>{c.error.slice(0, 40)}</div>}
                    </td>
                  </tr>
                ))}
                {!clients.length && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted">Ro‘yxat bo‘sh — «Holat» tanlab «Ro‘yxatni qurish» bosing.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!built && (
        <div className="card p-6 text-sm text-muted">
          Yuklandi. Endi yuqorida «Holat» (masalan <b>MIBda</b>) ni tanlab «Ro‘yxatni qurish» bosing — tekshiriladigan
          mijozlar ro‘yxati shakllanadi, so‘ng GO bosing.
        </div>
      )}
    </div>
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

function Stat({ label, value, accent, good, bad }: { label: string; value: string; accent?: boolean; good?: boolean; bad?: boolean }) {
  return (
    <div className="card p-3">
      <div className={cx('text-xl font-semibold tabular-nums', accent && 'text-brand-600 dark:text-brand-400', good && 'text-emerald-600 dark:text-emerald-300', bad && 'text-rose-600 dark:text-rose-300')}>{value}</div>
      <div className="mt-0.5 text-xs text-muted">{label}</div>
    </div>
  );
}
