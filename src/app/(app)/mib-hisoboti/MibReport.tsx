'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Ico, Spinner, useConfirm, Modal } from '@/ui';
import { useT } from '@/lib/i18n/client';
import { MibDashboard } from '../konveyer/MibDashboard';
import { RecheckModal, type RecheckInfo } from './RecheckModal';

// ── API shapes ────────────────────────────────────────────────────────────────
// Report ro'yxati (chap panel) + natija ko'rinishi endi MibDashboard'da (konveyer bilan bir xil).
interface Report {
  id: number; createdAt: string; label: string | null; sourceFileName: string; statusFilter: string | null;
  total: number; autoRun: boolean; runJobId: number | null;
}
interface ListReport extends Report { statusCounts: Record<string, number> }
interface SimRow { id: string; phone: string; label: string; state: 'pending' | 'on' | 'off'; webhookUrl: string; smsCount: number; lastSmsAt: string | null }
interface MibConfig {
  phone: string; sims: SimRow[]; untagged: { smsCount: number; lastSmsAt: string | null };
  baseUrl: string; intervalSec: number; webhookUrl: string; deepDetail: boolean; maxSims: number; error?: string;
}
// Avtomatordagi bilan bir xil: har SIMga bir vaqtda shuncha SMS «uchishda» (src/lib/mib/run.ts SMS_WINDOW).
const SMS_PER_SIM = 3;

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');
const n = (x: number) => (x || 0).toLocaleString('ru-RU');
const dt = (s: string) => new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

async function jget(url: string) { const r = await fetch(url, { cache: 'no-store' }); return r.json().catch(() => ({})); }
async function jpost(url: string, body?: unknown) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { ok: r.ok, status: r.status, json: await r.json().catch(() => ({})) };
}

export function MibReport() {
  const t = useT();
  const confirm = useConfirm();
  const [reports, setReports] = useState<ListReport[]>([]);
  const [selId, setSelId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aggregate, setAggregate] = useState(true); // kirganda default «Umumiy»

  const refresh = useCallback(async () => {
    const j = await jget(`/api/mib`);
    setReports(j.reports ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  // To'liq detal sahifasidan qaytganda tanlangan hisobot tiklanadi (?report=<id>).
  useEffect(() => {
    const r = Number(new URLSearchParams(window.location.search).get('report'));
    if (Number.isInteger(r) && r > 0) { setSelId(r); setAggregate(false); } // detal sahifadan qaytish
  }, []);

  const anyRunning = reports.some((r) => r.autoRun);
  useEffect(() => {
    if (!anyRunning) return;
    const t = setInterval(() => void refresh(), 4000);
    return () => clearInterval(t);
  }, [anyRunning, refresh]);

  const del = async (r: ListReport) => {
    const ok = await confirm({ title: t('Hisobotni o‘chirish'), description: `«${r.label || r.sourceFileName}» ${t('va uning barcha natijalari o‘chiriladi. Davom etilsinmi?')}`, confirmLabel: t('O‘chirish'), danger: true });
    if (!ok) return;
    const res = await jpost(`/api/mib/${r.id}`);
    if (res.status === 409) { alert(t('Avtomator ishlayapti — avval STOP bosing')); return; }
    await fetch(`/api/mib/${r.id}`, { method: 'DELETE' });
    if (selId === r.id) setSelId(null);
    await refresh();
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">{t('MIB hisoboti')}</h1>
            <span className="badge border-brand-500/30 text-brand-600 dark:text-brand-400">{t('Alohida · stepga kirmaydi')}</span>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            {t('mib.uz dan ijro ishlarini tekshiring — bitta PINFL yoki Excel roʻyxat bilan. Natija (ijro ishlari, hudud, bank, summa) saqlanadi; hudud/firma boʻyicha kesim va mijoz sahifasida batafsil koʻrasiz.')}
          </p>
        </div>
        <button className="btn-ghost shrink-0" onClick={() => setSettingsOpen(true)}><Ico.settings size={16} /> {t('Sozlamalar')}</button>
      </header>

      <TekshirishCard onUploaded={(id) => { void refresh(); setSelId(id); }} />

      <ReportChips reports={reports} loading={loading} selId={aggregate ? -1 : selId}
        onSelect={(id) => { setAggregate(false); setSelId(id); }}
        onUmumiy={() => { setAggregate(true); setSelId(null); }} onDelete={del} />

      {aggregate ? (
        <MibDashboard key="agg" reportId={0} aggregate variant="standalone" clientHrefBase="/mib-hisoboti/mijoz" />
      ) : selId != null ? (
        <MibDashboard key={selId} reportId={selId} variant="standalone" onChanged={refresh} clientHrefBase="/mib-hisoboti/mijoz" />
      ) : (
        <div className="card grid place-items-center gap-2 p-12 text-center text-sm text-muted">
          <Ico.chart size={24} className="text-muted/60" />
          {t('Yuqorida')} <b className="text-fg">{t('Tekshirish')}</b> {t('(PINFL yoki Excel) qiling,')} <b className="text-fg">{t('Umumiy')}</b> {t('yoki tayyor hisobotni tanlang.')}
        </div>
      )}

      <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} size="lg" title={t('MIB sozlamalari')} description={t('SIM kartalar (SMS OTP), interval, chuqur detal va webhook')}>
        <ConfigCard />
      </Modal>
    </div>
  );
}

// ── Tekshirish: bitta PINFL yoki Excel ro'yxat (bitta karta, ikki rejim) ──────────
function TekshirishCard({ onUploaded }: { onUploaded: (id: number) => void }) {
  const t = useT();
  const router = useRouter();
  const [mode, setMode] = useState<'pinfl' | 'excel'>('pinfl');
  // Bitta PINFL — «Qo'lda tekshiruvlar» reportiga qo'shilib darhol tekshiriladi, mijoz sahifasi ochiladi.
  const [pinfl, setPinfl] = useState('');
  const [pBusy, setPBusy] = useState(false);
  const [pMsg, setPMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Reused PINFL — modal (window.confirm o'rniga): sana + ish soni + arxiv izohli.
  const [reusedInfo, setReusedInfo] = useState<(RecheckInfo & { clientId: number }) | null>(null);
  const checkPinfl = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = pinfl.replace(/\D/g, '');
    if (p.length !== 14) { setPMsg({ ok: false, text: t('PINFL 14 ta raqamdan iborat boʻlishi kerak') }); return; }
    setPBusy(true); setPMsg(null);
    const { ok, json } = await jpost(`/api/mib/check-pinfl`, { pinfl: p });
    setPBusy(false);
    if (!ok) { setPMsg({ ok: false, text: json.error || t('Xatolik') }); return; }
    if (json.reused) {
      // Modal ochamiz. «Yangi dalniy olamiz» → force=true, «Eski natijaga o'tish» → mavjud sahifa.
      setReusedInfo({ pinfl: p, lastCheckedAt: json.lastCheckedAt, cases: json.cases, clientId: json.clientId });
      return;
    }
    router.push(`/mib-hisoboti/mijoz/${json.clientId}`);
  };
  const doForce = async () => {
    if (!reusedInfo) return;
    const { json } = await jpost(`/api/mib/check-pinfl`, { pinfl: reusedInfo.pinfl, force: true });
    setReusedInfo(null);
    router.push(`/mib-hisoboti/mijoz/${json.clientId || reusedInfo.clientId}`);
  };
  const doKeepOld = () => { if (reusedInfo) router.push(`/mib-hisoboti/mijoz/${reusedInfo.clientId}`); };
  // Excel — HISOBOT ro'yxatini yuklab, «Holat» bo'yicha qurib GO qilinadi.
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState('');
  const [uBusy, setUBusy] = useState(false);
  const [uErr, setUErr] = useState('');
  const upload = async () => {
    if (!file) { setUErr(t('Fayl tanlang')); return; }
    setUErr(''); setUBusy(true);
    try {
      const fd = new FormData(); fd.append('file', file); if (label.trim()) fd.append('label', label.trim());
      const res = await fetch(`/api/mib/upload`, { method: 'POST', body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setUErr(j.error || t('Xatolik')); return; }
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
      <RecheckModal open={!!reusedInfo} info={reusedInfo} onClose={() => setReusedInfo(null)} onConfirm={doForce} onKeepOld={doKeepOld} />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-300"><Ico.flash size={20} /></span>
        <div className="min-w-0">
          <div className="text-sm font-semibold">{t('Tekshirish')}</div>
          <div className="text-xs text-muted">{t('mib.uz dan ijro ishlari — bitta PINFL yoki Excel roʻyxat bilan')}</div>
        </div>
        <div className="ml-auto flex gap-0.5 rounded-xl border border-line p-0.5"><Tab v="pinfl">{t('Bitta PINFL')}</Tab><Tab v="excel">{t('Excel roʻyxat')}</Tab></div>
      </div>

      {mode === 'pinfl' ? (
        <form onSubmit={checkPinfl} className="flex flex-wrap items-center gap-2">
          <input className="field-input w-[220px] tabular-nums tracking-[0.1em]" inputMode="numeric" maxLength={14} placeholder={t('14 raqamli PINFL')}
            value={pinfl} onChange={(e) => { setPinfl(e.target.value.replace(/\D/g, '').slice(0, 14)); setPMsg(null); }} />
          <button type="submit" className="btn-primary shrink-0" disabled={pBusy || pinfl.replace(/\D/g, '').length !== 14}>
            {pBusy ? <Spinner size={16} /> : <Ico.send size={16} />} {t('Tekshirish')}
          </button>
          {pMsg && <span className={cx('text-sm', pMsg.ok ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300')}>{pMsg.text}</span>}
          <span className="ml-auto text-xs text-muted">{t('Excel shart emas · natija sana bilan saqlanadi')}</span>
        </form>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[240px] flex-1">
              <span className="field-label">{t('HISOBOT Excel (.xlsx)')}</span>
              <input ref={fileRef} type="file" accept=".xlsx" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <button type="button" onClick={() => fileRef.current?.click()} className="btn-ghost w-full justify-start"><Ico.sheet size={16} /><span className="truncate">{file ? file.name : t('Fayl tanlang…')}</span></button>
            </div>
            <div className="min-w-[160px] flex-1">
              <span className="field-label">{t('Nom (ixtiyoriy)')}</span>
              <input className="field-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('masalan: HISOBOT 120')} />
            </div>
            <button className="btn-primary shrink-0" disabled={uBusy || !file} onClick={upload}>{uBusy ? <Spinner size={16} /> : <Ico.filePlus size={16} />} {t('Yuklash')}</button>
          </div>
          <div className="mt-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs text-muted">
            <div className="mb-1 font-semibold text-fg">{t('Excel ustunlari (1-qator — sarlavha)')}:</div>
            <ul className="ml-4 list-disc space-y-0.5">
              <li><b className="text-fg">PINFL</b> — {t('majburiy, 14 raqam; PINFL yoʻq qatorlar oʻtkazib yuboriladi')}</li>
              <li><b className="text-fg">Holat</b> — {t('filtr (masalan «MIBda») shu ustun boʻyicha quriladi')}</li>
              <li>{t('Ixtiyoriy')}: <span className="text-fg">F.I.SH., Telefon, MKO, Ish raqami, Viloyat, Manzil, Jami qarzdorlik, Yuborilgan sana</span></li>
            </ul>
            <div className="mt-1">{t('Sarlavhalar kiril yoki lotin boʻlishi mumkin. Faqat birinchi varaq oʻqiladi.')}</div>
          </div>
          {uErr && <p className="mt-2 text-sm font-medium text-rose-600 dark:text-rose-300">{uErr}</p>}
        </>
      )}
    </div>
  );
}

// ── Config (SIMlar / interval / webhook) ──────────────────────────────────────
const fmtPhone = (p: string) => { const d = p.replace(/\D/g, ''); return d.length === 12 ? `+${d.slice(0, 3)} ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8, 10)} ${d.slice(10)}` : `+${d}`; };

function ConfigCard() {
  const t = useT();
  const confirm = useConfirm();
  const [cfg, setCfg] = useState<MibConfig | null>(null);
  const [interval, setIntervalS] = useState('60');
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState('');
  // yangi SIM
  const [phone9, setPhone9] = useState(''); // national 9 digits
  const [label, setLabel] = useState('');
  const [simErr, setSimErr] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    const j = await jget(`/api/mib/config`) as MibConfig;
    setCfg(j); setIntervalS(String(j.intervalSec || 60));
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Har amal yangilangan to'liq sozlamani qaytaradi.
  const act = async (key: string, body: unknown): Promise<boolean> => {
    setBusy(key); setSimErr('');
    const { ok, json } = await jpost(`/api/mib/config`, body);
    setBusy('');
    if (!ok) { setSimErr(json?.error || t('Xatolik')); return false; }
    setCfg(json as MibConfig);
    return true;
  };

  const save = async () => {
    // Interval kamida 60s — bundan tez urish MIB tomonidan bloklanadi.
    if (await act('save', { intervalSec: Math.max(60, Number(interval) || 60) })) { setSaved(true); setTimeout(() => setSaved(false), 1500); }
  };
  const toggleDeep = async () => {
    const next = !(cfg?.deepDetail ?? true);
    setCfg((c) => c ? { ...c, deepDetail: next } : c); // darhol ko'rinsin
    await act('deep', { deepDetail: next });
  };
  const addSim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (phone9.length !== 9) { setSimErr(t('Telefon raqami 9 ta raqamdan iborat boʻlishi kerak')); return; }
    if (await act('add', { addSim: { phone: `998${phone9}`, label } })) { setPhone9(''); setLabel(''); }
  };
  const setSimState = (sim: SimRow, state: 'on' | 'off') => act(`st-${sim.id}`, { updateSim: { id: sim.id, state } });
  const removeSim = async (sim: SimRow) => {
    const yes = await confirm({ title: t('SIMni oʻchirish'), description: `${sim.label} · ${fmtPhone(sim.phone)} ${t('roʻyxatdan olib tashlanadi — unga SMS soʻralmaydi.')}`, confirmLabel: t('Oʻchirish'), danger: true });
    if (yes) await act(`rm-${sim.id}`, { removeSim: sim.id });
  };
  const copy = (key: string, text: string) => { void navigator.clipboard?.writeText(text); setCopied(key); setTimeout(() => setCopied(''), 1200); };

  // Test the SMS pipeline: wait for a code to arrive at the webhook (operator sends a test SMS).
  const [testState, setTestState] = useState<'idle' | 'waiting' | 'ok' | 'timeout'>('idle');
  const [testCode, setTestCode] = useState('');
  const [testSim, setTestSim] = useState<string | null>(null);
  const testSms = async () => {
    setTestState('waiting'); setTestCode(''); setTestSim(null);
    const start = await jpost(`/api/mib/test-sms`);
    const baseline = Number(start.json?.baselineId) || 0;
    const deadline = Date.now() + 90_000;
    const tick = async () => {
      if (Date.now() > deadline) { setTestState('timeout'); return; }
      const r = await jget(`/api/mib/test-sms?after=${baseline}`);
      if (r?.code) {
        setTestCode(String(r.code)); setTestSim(r.sim ?? null);
        setTestState('ok');
        // SMS kelishi — o'sha SIM ishlayotganining isboti (kutayotgani yoqiladi); holatni yangilaymiz.
        void load();
        return;
      }
      setTimeout(() => { void tick(); }, 3000);
    };
    void tick();
  };

  const sims = cfg?.sims ?? [];
  const onSims = sims.filter((x) => x.state === 'on');
  // Kodlar SIM bo'yicha ajraladimi: har ishlayotgan SIM o'z manzilidan kamida bitta SMS olgan.
  const perSim = onSims.length > 1 && onSims.every((x) => x.smsCount > 0);
  const parallel = perSim ? onSims.length * SMS_PER_SIM : SMS_PER_SIM;
  const testSimRow = testSim ? sims.find((x) => x.id === testSim) : null;

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><Ico.settings size={16} className="text-brand-600 dark:text-brand-400" /> {t('Sozlamalar')}</div>

      {/* ── SIM kartalar: SMS-OTP shu raqamlarga so'raladi. Bir nechta bo'lsa so'rovlar taqsimlanadi. ── */}
      <div className="rounded-xl border border-line">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
          <div className="text-sm font-medium">{t('SIM kartalar (SMS keladigan raqamlar)')}</div>
          <div className="text-xs text-muted">
            {onSims.length === 0
              ? <span className="text-rose-600 dark:text-rose-300">{t('ishlayotgan SIM yoʻq — chuqur detal olinmaydi')}</span>
              : <><b className="tabular-nums text-fg">{onSims.length}</b> {t('ta SIM ishlayapti')} · {t('bir vaqtda')} <b className="tabular-nums text-fg">{parallel}</b> {t('ta SMS')}</>}
          </div>
        </div>

        {sims.length === 0 && <p className="px-3 py-4 text-sm text-muted">{t('Hali SIM qoʻshilmagan. Pastda raqamni kiriting.')}</p>}
        {sims.map((sim) => {
          const stBusy = busy === `st-${sim.id}`;
          return (
            <div key={sim.id} className="space-y-2 border-b border-line px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-xs font-semibold text-muted">{sim.id.replace(/^s/, '')}</span>
                <div className="min-w-0">
                  <div className="text-sm font-medium tabular-nums">{fmtPhone(sim.phone)} <span className="font-normal text-muted">· {sim.label}</span></div>
                  <div className="text-[11px] text-muted">
                    {sim.lastSmsAt ? <>{t('oxirgi SMS')}: {dt(sim.lastSmsAt)} · {n(sim.smsCount)} {t('ta')}</> : t('shu manzilga hali SMS kelmagan')}
                  </div>
                </div>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  {sim.state === 'on' && <span className="badge border-emerald-500/30 text-emerald-600 dark:text-emerald-300">{t('ishlayapti')}</span>}
                  {sim.state === 'off' && <span className="badge border-line text-muted">{t('oʻchirilgan')}</span>}
                  {sim.state === 'pending' && <span className="badge border-amber-500/30 text-amber-600 dark:text-amber-300">{t('tasdiqlanmagan')}</span>}
                  {sim.state === 'pending' ? (
                    <button className="btn-ghost px-2.5 py-1 text-xs" disabled={stBusy} onClick={() => setSimState(sim, 'on')} title={t('Test SMS’ni kutmasdan qoʻlda yoqish')}>
                      {stBusy ? <Spinner size={13} /> : <Ico.check size={13} />} {t('Yoqish')}
                    </button>
                  ) : (
                    <button role="switch" aria-checked={sim.state === 'on'} aria-label={t('SIMni yoqish/oʻchirish')} disabled={stBusy} onClick={() => setSimState(sim, sim.state === 'on' ? 'off' : 'on')}
                      className={cx('relative h-6 w-11 shrink-0 rounded-full transition-colors', sim.state === 'on' ? 'bg-brand-500' : 'bg-slate-300 dark:bg-slate-600')}>
                      <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', sim.state === 'on' ? 'left-[22px]' : 'left-0.5')} />
                    </button>
                  )}
                  <button className="grid h-7 w-7 place-items-center rounded-lg text-muted hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-300" onClick={() => removeSim(sim)} title={t('Oʻchirish')} aria-label={t('Oʻchirish')}>
                    <Ico.trash size={14} />
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5">
                <span className="shrink-0 text-[11px] text-muted">{t('Shu telefon forwarderi manzili:')}</span>
                <code className="min-w-0 flex-1 truncate text-xs">{sim.webhookUrl}</code>
                <button className="btn-ghost shrink-0 px-2 py-0.5 text-xs" onClick={() => copy(sim.id, sim.webhookUrl)}>
                  {copied === sim.id ? <Ico.check size={13} /> : <Ico.files size={13} />} {copied === sim.id ? t('Nusxa olindi') : t('Nusxa')}
                </button>
              </div>
              {sim.state === 'pending' && (
                <p className="text-[11px] text-amber-600 dark:text-amber-300">
                  {t('Bu raqamga hali SMS soʻralmaydi. Telefon forwarderiga yuqoridagi manzilni qoʻyib «SMS ni tekshirish» bosing va shu SIMga test SMS yuboring — kelishi bilan oʻzi yoqiladi.')}
                </p>
              )}
            </div>
          );
        })}

        <form onSubmit={addSim} className="flex flex-wrap items-end gap-2 px-3 py-2.5">
          <label className="min-w-[200px] flex-1">
            <span className="field-label">{t('Yangi SIM raqami')}</span>
            <div className="flex items-center rounded-xl border border-[var(--field-line)] bg-[var(--field)] pl-3.5 transition focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/25">
              <span className="select-none pr-2 text-sm font-medium tabular-nums text-muted">+998</span>
              <input className="w-full bg-transparent py-2.5 pr-3.5 text-sm tabular-nums tracking-[0.15em] text-fg outline-none placeholder:tracking-normal placeholder:text-muted/60" inputMode="numeric" maxLength={9} placeholder="901234567"
                value={phone9} onChange={(e) => { setPhone9(e.target.value.replace(/\D/g, '').slice(0, 9)); setSimErr(''); }} />
            </div>
          </label>
          <label className="w-[150px]">
            <span className="field-label">{t('Nomi (ixtiyoriy)')}</span>
            <input className="field-input" maxLength={30} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={`SIM ${sims.length + 1}`} />
          </label>
          <button type="submit" className="btn-ghost shrink-0" disabled={busy === 'add' || phone9.length !== 9 || sims.length >= (cfg?.maxSims ?? 6)}>
            {busy === 'add' ? <Spinner size={16} /> : <Ico.add size={16} />} {t('SIM qoʻshish')}
          </button>
        </form>
        {simErr && <p className="px-3 pb-2.5 text-sm font-medium text-rose-600 dark:text-rose-300">{simErr}</p>}
      </div>

      {/* Tezlik izohi: SIMlar soni tezlikni faqat kodlar ajratilganda oshiradi. */}
      {onSims.length > 1 && (
        <p className={cx('mt-2 rounded-lg border px-3 py-2 text-xs', perSim ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300' : 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300')}>
          {perSim
            ? `${t('SMS soʻrovlari')} ${onSims.length} ${t('ta SIM orasida teng taqsimlanadi — har biriga bir vaqtda')} ${SMS_PER_SIM} ${t('tadan. Biror SIM javob bermay qolsa, u vaqtincha chetlatilib ishlar qolganlariga oʻtadi.')}`
            : t('SIMlar navbatlashadi, lekin tezlik hali oshmaydi: baʼzi SIM oʻz manzilidan SMS olmagan, shuning uchun kodlar aralash keladi. Har telefon forwarderiga OʻZ manzilini qoʻying va har biridan bir marta test SMS yuboring.')}
        </p>
      )}
      {(cfg?.untagged?.smsCount ?? 0) > 0 && sims.length > 1 && cfg?.untagged.lastSmsAt && (
        <p className="mt-1 text-[11px] text-muted">{t('Umumiy (SIMsiz) manzilga oxirgi SMS')}: {dt(cfg.untagged.lastSmsAt)} — {t('forwarderlarda eski manzil qolgan boʻlsa, yuqoridagi SIM manzillariga almashtiring.')}</p>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-[180px_auto] sm:items-end sm:justify-start">
        <label>
          <span className="field-label">{t('Interval (sekund, eng kami 60)')}</span>
          <input className="field-input tabular-nums" inputMode="numeric" value={interval} onChange={(e) => setIntervalS(e.target.value.replace(/\D/g, ''))} />
        </label>
        <button className="btn-primary shrink-0" disabled={busy === 'save'} onClick={save}>{saved ? <><Ico.check size={16} /> {t('Saqlandi')}</> : t('Saqlash')}</button>
      </div>

      {/* Chuqur detal (SMS) — o'chirilsa har ish uchun SMS so'ralmaydi, faqat ijro ishi ro'yxati (tez). */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface-2/40 px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-sm font-medium">{t('Chuqur detal (SMS bilan)')}</div>
          <div className="text-xs text-muted">
            {(cfg?.deepDetail ?? true)
              ? t('Yoqilgan — har ijro ishi uchun SMS-OTP so‘raladi (bank/sud/summa to‘ladi).')
              : t('O‘chirilgan — SMS so‘ralmaydi, faqat ijro ishlari ro‘yxati olinadi (tez, «birdan»).')}
          </div>
        </div>
        <button role="switch" aria-checked={cfg?.deepDetail ?? true} onClick={toggleDeep}
          className={cx('relative h-6 w-11 shrink-0 rounded-full transition-colors', (cfg?.deepDetail ?? true) ? 'bg-brand-500' : 'bg-slate-300 dark:bg-slate-600')}>
          <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', (cfg?.deepDetail ?? true) ? 'left-[22px]' : 'left-0.5')} />
        </button>
      </div>

      {/* Test the SMS pipeline (phone → forwarder → webhook) before running the automator. */}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button className="btn-ghost" disabled={testState === 'waiting'} onClick={testSms}>
          {testState === 'waiting' ? <Spinner size={16} /> : <Ico.send size={16} />} {t('SMS ni tekshirish')}
        </button>
        {testState === 'waiting' && <span className="text-sm text-amber-600 dark:text-amber-300">{t('Telefondan test SMS yuboring — kelishi kutilmoqda…')}</span>}
        {testState === 'ok' && (
          <span className="text-sm font-medium text-emerald-600 dark:text-emerald-300">
            {t('✓ Tasdiqlandi — kod keldi:')} <b className="tabular-nums">{testCode}</b>
            {testSimRow ? <> · {testSimRow.label} ({fmtPhone(testSimRow.phone)})</> : sims.length > 1 ? <span className="text-amber-600 dark:text-amber-300"> · {t('umumiy manzilga keldi (qaysi SIM ekani nomaʼlum)')}</span> : null}
          </span>
        )}
        {testState === 'timeout' && <span className="text-sm text-rose-600 dark:text-rose-300">{t('⏱ 90s ichida SMS kelmadi — telefon/forwarder/webhook’ni tekshiring.')}</span>}
      </div>
    </div>
  );
}

// ── Hisobotlar — gorizontal chiplar (tanlash + o'chirish) ─────────────────────────
function ReportChips({ reports, loading, selId, onSelect, onUmumiy, onDelete }: { reports: ListReport[]; loading: boolean; selId: number | null; onSelect: (id: number) => void; onUmumiy: () => void; onDelete: (r: ListReport) => void }) {
  const t = useT();
  if (loading) return <div className="flex items-center gap-2 text-sm text-muted"><Spinner size={14} /> {t('Hisobotlar…')}</div>;
  if (!reports.length) return null;
  const umumiyActive = selId === -1;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted">{t('Hisobotlar:')}</span>
      <button onClick={onUmumiy}
        className={cx('inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm font-medium transition-colors',
          umumiyActive ? 'border-brand-500 bg-brand-500/10 text-brand-700 dark:text-brand-300' : 'border-line text-muted hover:bg-surface-2 hover:text-fg')}>
        <Ico.layer size={14} /> {t('Umumiy')}
      </button>
      <span className="mx-0.5 h-5 w-px bg-line" />
      {reports.map((r) => {
        const done = (r.statusCounts.DONE ?? 0) + (r.statusCounts.CLEAN ?? 0);
        const active = selId === r.id;
        return (
          <div key={r.id} className={cx('group inline-flex items-center gap-2 rounded-xl border py-1.5 pl-3 pr-1.5 text-sm transition-colors',
            active ? 'border-brand-500 bg-brand-500/10 text-brand-700 dark:text-brand-300' : 'border-line text-muted hover:bg-surface-2 hover:text-fg')}>
            <button onClick={() => onSelect(r.id)} className="flex items-center gap-2">
              {r.autoRun && <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />}
              <span className="max-w-[220px] truncate font-medium">{r.label || r.sourceFileName}</span>
              {r.total > 0 && <span className="tabular-nums text-xs opacity-70">{n(done)}/{n(r.total)}</span>}
            </button>
            <button onClick={() => onDelete(r)} title={t('O‘chirish')} className="grid h-6 w-6 place-items-center rounded-lg text-muted opacity-0 transition-opacity hover:bg-rose-500/10 hover:text-rose-600 focus-visible:opacity-100 group-hover:opacity-100 dark:hover:text-rose-300">
              <Ico.trash size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
