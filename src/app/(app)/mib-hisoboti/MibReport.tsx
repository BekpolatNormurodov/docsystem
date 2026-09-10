'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Ico, Spinner, useConfirm } from '@/ui';
import { MibDashboard } from '../konveyer/MibDashboard';

// ── API shapes ────────────────────────────────────────────────────────────────
// Report ro'yxati (chap panel) + natija ko'rinishi endi MibDashboard'da (konveyer bilan bir xil).
interface Report {
  id: number; createdAt: string; label: string | null; sourceFileName: string; statusFilter: string | null;
  total: number; autoRun: boolean; runJobId: number | null;
}
interface ListReport extends Report { statusCounts: Record<string, number> }
interface MibConfig { phone: string; phonePending: string; phoneConfirmedAt: string; baseUrl: string; intervalSec: number; webhookUrl: string }

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
          <MibDashboard key={selId} reportId={selId} variant="standalone" onChanged={refresh} />
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
    // Interval kamida 60s — bundan tez urish MIB tomonidan bloklanadi.
    const { json } = await jpost('/api/mib/config', { phone: full, intervalSec: Math.max(60, Number(interval) || 60) });
    setCfg((c) => c ? { ...c, ...json } : c);
    if (json?.intervalSec) setIntervalS(String(json.intervalSec));
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
      if (r?.code) {
        setTestCode(String(r.code));
        setTestState('ok');
        // SMS kelishi — kutayotgan raqamning haqiqiyligi isboti. Server uni shu paytda
        // ishlayotgan raqamga aylantiradi; sozlamani qayta o'qib holatni yangilaymiz.
        if (r.confirmedPhone) void load();
        return;
      }
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
          <span className="field-label">Interval (sekund, eng kami 60)</span>
          <input className="field-input tabular-nums" inputMode="numeric" value={interval} onChange={(e) => setIntervalS(e.target.value.replace(/\D/g, ''))} />
        </label>
        <button className="btn-primary shrink-0" onClick={save}>{saved ? <><Ico.check size={16} /> Saqlandi</> : 'Saqlash'}</button>
      </div>

      {/* Raqam holati: saqlash o'zi raqamni ALMASHTIRMAYDI — faqat o'sha raqamdan test SMS
          kelgach almashadi. Shunda xato terilgan raqam OTP oqimini jimgina sindirmaydi. */}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">Ishlayotgan raqam:</span>
        {cfg?.phone
          ? <span className="badge border-emerald-500/30 text-emerald-600 dark:text-emerald-300 tabular-nums">+{cfg.phone} · tasdiqlangan</span>
          : <span className="badge border-line text-muted">hali yo‘q</span>}
        {cfg?.phonePending && (
          <>
            <span className="badge border-amber-500/30 text-amber-600 dark:text-amber-300 tabular-nums">
              +{cfg.phonePending} · tasdiqlanmagan
            </span>
            <span className="text-amber-600 dark:text-amber-300">
              — shu raqamdan test SMS yuboring, shundan keyingina almashadi
            </span>
          </>
        )}
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
