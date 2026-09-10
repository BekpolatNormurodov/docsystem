'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Ico, Spinner, useConfirm, Modal } from '@/ui';
import { MibDashboard } from '../konveyer/MibDashboard';

// ── API shapes ────────────────────────────────────────────────────────────────
// Report ro'yxati (chap panel) + natija ko'rinishi endi MibDashboard'da (konveyer bilan bir xil).
interface Report {
  id: number; createdAt: string; label: string | null; sourceFileName: string; statusFilter: string | null;
  total: number; autoRun: boolean; runJobId: number | null;
}
interface ListReport extends Report { statusCounts: Record<string, number> }
interface MibConfig { phone: string; phonePending: string; phoneConfirmedAt: string; baseUrl: string; intervalSec: number; webhookUrl: string; deepDetail: boolean }

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
  const [settingsOpen, setSettingsOpen] = useState(false);

  const refresh = useCallback(async () => {
    const j = await jget('/api/mib');
    setReports(j.reports ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  // To'liq detal sahifasidan qaytganda tanlangan hisobot tiklanadi (?report=<id>).
  useEffect(() => {
    const r = Number(new URLSearchParams(window.location.search).get('report'));
    if (Number.isInteger(r) && r > 0) setSelId(r);
  }, []);

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
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">MIB hisoboti</h1>
            <span className="badge border-brand-500/30 text-brand-600 dark:text-brand-400">Alohida · stepga kirmaydi</span>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            mib.uz dan ijro ishlarini tekshiring — bitta PINFL yoki Excel roʻyxat bilan. Natija (ijro ishlari, hudud,
            bank, summa) saqlanadi; hudud/firma boʻyicha kesim va mijoz sahifasida batafsil koʻrasiz.
          </p>
        </div>
        <button className="btn-ghost shrink-0" onClick={() => setSettingsOpen(true)}><Ico.settings size={16} /> Sozlamalar</button>
      </header>

      <TekshirishCard onUploaded={(id) => { void refresh(); setSelId(id); }} />

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <HistoryList reports={reports} loading={loading} selId={selId} onSelect={setSelId} onDelete={del} />
        {selId != null ? (
          <MibDashboard key={selId} reportId={selId} variant="standalone" onChanged={refresh} clientHrefBase="/mib-hisoboti/mijoz" />
        ) : (
          <div className="card grid place-items-center gap-2 p-10 text-center text-sm text-muted">
            <Ico.chart size={22} className="text-muted/60" />
            Yuqorida <b className="text-fg">Tekshirish</b> (PINFL yoki Excel) qiling, yoki chapdan tayyor hisobotni tanlang.
          </div>
        )}
      </div>

      <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} size="lg" title="MIB sozlamalari" description="Telefon (SMS OTP), interval, chuqur detal va webhook">
        <ConfigCard />
      </Modal>
    </div>
  );
}

// ── Tekshirish: bitta PINFL yoki Excel ro'yxat (bitta karta, ikki rejim) ──────────
function TekshirishCard({ onUploaded }: { onUploaded: (id: number) => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<'pinfl' | 'excel'>('pinfl');
  // Bitta PINFL — «Qo'lda tekshiruvlar» reportiga qo'shilib darhol tekshiriladi, mijoz sahifasi ochiladi.
  const [pinfl, setPinfl] = useState('');
  const [pBusy, setPBusy] = useState(false);
  const [pMsg, setPMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const checkPinfl = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = pinfl.replace(/\D/g, '');
    if (p.length !== 14) { setPMsg({ ok: false, text: 'PINFL 14 ta raqamdan iborat boʻlishi kerak' }); return; }
    setPBusy(true); setPMsg(null);
    const { ok, json } = await jpost('/api/mib/check-pinfl', { pinfl: p });
    if (!ok) { setPMsg({ ok: false, text: json.error || 'Xatolik' }); setPBusy(false); return; }
    router.push(`/mib-hisoboti/mijoz/${json.clientId}`);
  };
  // Excel — HISOBOT ro'yxatini yuklab, «Holat» bo'yicha qurib GO qilinadi.
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState('');
  const [uBusy, setUBusy] = useState(false);
  const [uErr, setUErr] = useState('');
  const upload = async () => {
    if (!file) { setUErr('Fayl tanlang'); return; }
    setUErr(''); setUBusy(true);
    try {
      const fd = new FormData(); fd.append('file', file); if (label.trim()) fd.append('label', label.trim());
      const res = await fetch('/api/mib/upload', { method: 'POST', body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setUErr(j.error || 'Xatolik'); return; }
      setFile(null); setLabel(''); onUploaded(j.reportId);
    } finally { setUBusy(false); }
  };

  const Tab = ({ v, children }: { v: 'pinfl' | 'excel'; children: React.ReactNode }) => (
    <button onClick={() => setMode(v)}
      className={cx('rounded-lg px-3 py-1.5 text-sm font-medium transition-colors', mode === v ? 'bg-brand-500 text-white shadow-sm' : 'text-muted hover:text-fg')}>
      {children}
    </button>
  );

  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-500/12 text-brand-600 dark:text-brand-300"><Ico.flash size={20} /></span>
        <div className="min-w-0">
          <div className="text-sm font-semibold">Tekshirish</div>
          <div className="text-xs text-muted">mib.uz dan ijro ishlari — bitta PINFL yoki Excel roʻyxat bilan</div>
        </div>
        <div className="ml-auto flex gap-0.5 rounded-xl border border-line p-0.5"><Tab v="pinfl">Bitta PINFL</Tab><Tab v="excel">Excel roʻyxat</Tab></div>
      </div>

      {mode === 'pinfl' ? (
        <form onSubmit={checkPinfl} className="flex flex-wrap items-center gap-2">
          <input className="field-input w-[220px] tabular-nums tracking-[0.1em]" inputMode="numeric" maxLength={14} placeholder="14 raqamli PINFL"
            value={pinfl} onChange={(e) => { setPinfl(e.target.value.replace(/\D/g, '').slice(0, 14)); setPMsg(null); }} />
          <button type="submit" className="btn-primary shrink-0" disabled={pBusy || pinfl.replace(/\D/g, '').length !== 14}>
            {pBusy ? <Spinner size={16} /> : <Ico.send size={16} />} Tekshirish
          </button>
          {pMsg && <span className={cx('text-sm', pMsg.ok ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300')}>{pMsg.text}</span>}
          <span className="ml-auto text-xs text-muted">Excel shart emas · natija sana bilan saqlanadi</span>
        </form>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[240px] flex-1">
              <span className="field-label">HISOBOT Excel (.xlsx)</span>
              <input ref={fileRef} type="file" accept=".xlsx" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <button type="button" onClick={() => fileRef.current?.click()} className="btn-ghost w-full justify-start"><Ico.sheet size={16} /><span className="truncate">{file ? file.name : 'Fayl tanlang…'}</span></button>
            </div>
            <div className="min-w-[160px] flex-1">
              <span className="field-label">Nom (ixtiyoriy)</span>
              <input className="field-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="masalan: HISOBOT 120" />
            </div>
            <button className="btn-primary shrink-0" disabled={uBusy || !file} onClick={upload}>{uBusy ? <Spinner size={16} /> : <Ico.filePlus size={16} />} Yuklash</button>
          </div>
          {uErr && <p className="mt-2 text-sm font-medium text-rose-600 dark:text-rose-300">{uErr}</p>}
        </>
      )}
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

  const toggleDeep = async () => {
    const next = !(cfg?.deepDetail ?? true);
    setCfg((c) => c ? { ...c, deepDetail: next } : c); // darhol ko'rinsin
    const { json } = await jpost('/api/mib/config', { deepDetail: next });
    setCfg((c) => c ? { ...c, ...json } : c);
  };

  // Kutayotgan raqamni test SMS'siz, qo'lда ishlaydigan qilib qo'yish.
  const activatePending = async () => {
    const { json } = await jpost('/api/mib/config', { activatePending: true });
    setCfg((c) => c ? { ...c, ...json } : c);
    setPhone9(toNational(json?.phone || ''));
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

      {/* Chuqur detal (SMS) — o'chirilsa har ish uchun SMS so'ralmaydi, faqat ijro ishi ro'yxati (tez). */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface-2/40 px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-sm font-medium">Chuqur detal (SMS bilan)</div>
          <div className="text-xs text-muted">
            {(cfg?.deepDetail ?? true)
              ? 'Yoqilgan — har ijro ishi uchun SMS-OTP so‘raladi (bank/sud/summa to‘ladi).'
              : 'O‘chirilgan — SMS so‘ralmaydi, faqat ijro ishlari ro‘yxati olinadi (tez, «birdan»).'}
          </div>
        </div>
        <button role="switch" aria-checked={cfg?.deepDetail ?? true} onClick={toggleDeep}
          className={cx('relative h-6 w-11 shrink-0 rounded-full transition-colors', (cfg?.deepDetail ?? true) ? 'bg-brand-500' : 'bg-slate-300 dark:bg-slate-600')}>
          <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', (cfg?.deepDetail ?? true) ? 'left-[22px]' : 'left-0.5')} />
        </button>
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
            <button className="btn-ghost px-2.5 py-1 text-xs" onClick={activatePending}>
              <Ico.check size={13} /> Shu raqamga oʻtkazish
            </button>
            <span className="text-xs text-amber-600 dark:text-amber-300">
              — yoki shu raqamdan test SMS yuboring
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
