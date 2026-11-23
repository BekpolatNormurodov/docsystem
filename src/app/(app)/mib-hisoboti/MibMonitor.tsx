'use client';

// MIB avtomatori — JONLI MONITOR oynasi (bitta hisobot run'i). Operator bir qarashda ko'radi:
//   • run holati (ishlayapti / ulanish kutilmoqda / to'xtagan) va bir vaqtda nechta SMS «uchishda»;
//   • har SIM kartasi: nechta SMS so'raldi, nechtasida kod keldi / kelmadi, muvaffaqiyat %, telefon slotі,
//     oxirgi 60 daqiqada shu SIMga kelgan SMS'lar — ya'ni «2 ta SIM bilan ketyaptimi» savoliga javob;
//   • faqat shu hisobot loglari — tur (SMS / natija / xato) va SIM bo'yicha filtr, qidiruv, pauza, yuklab olish.
// Ma'lumot /api/mib/logs?report=<id> dan (2 s poll); run statistikasi serverda xotirada (src/lib/mib/run.ts).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ico, Modal, Spinner } from '@/ui';
import { useT } from '@/lib/i18n/client';

interface Line { id: number; ts: number; msg: string }
interface Waiting { pinfl: string; work: string; at: number; until: number; tries: number }
interface SimStat { id: string; label: string; phone: string; tagged: boolean; requested: number; ok: number; miss: number; inflight: number; lastReqAt?: number; lastOkAt?: number; benchedUntil?: number; restLvl?: number; timeoutMs?: number; waiting?: Waiting[] }
interface Monitor {
  active: boolean;
  run: { startedAt: number; since: number; perSim: boolean; window: number; sims: SimStat[] } | null;
  saved: { since: number; sims: Record<string, Pick<SimStat, 'requested' | 'ok' | 'miss' | 'lastReqAt' | 'lastOkAt'>> } | null;
  progress: { total: number; checked: number; pending: number; failed: number; perMin: number; etaMin: number | null };
  halt: { at: number; reason: string; waiting: boolean; retryAt?: number; attempt?: number } | null;
  sims: { id: string; label: string; phone: string; state: 'pending' | 'on' | 'off'; slot: number | null }[];
  received: { key: string; count: number; used: number; lastAt: string | null }[];
}
type Kind = 'all' | 'sms' | 'ok' | 'err';

const cx = (...c: (string | false | undefined | null)[]) => c.filter(Boolean).join(' ');
const n = (x: number) => (x || 0).toLocaleString('ru-RU');
const fmtDur = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
const hhmmss = (ms: number) => new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
// SIM ranglari — ro'yxatdagi tartib bo'yicha (kartadagi va logdagi belgi bir xil rangda).
const SIM_TONE = [
  'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  'border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300',
  'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  'border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-300',
  'border-pink-500/40 bg-pink-500/10 text-pink-700 dark:text-pink-300',
  'border-lime-500/40 bg-lime-500/10 text-lime-700 dark:text-lime-300',
];

// Log qatorlari qisqa va belgili (src/lib/mib/run.ts): «✓» natija, «✗» xato, «→ SMS» so'rov, «⏸» kutish,
// «▶»/«■» boshlanish/tugash, «↻» qayta navbat.
export function kindOf(msg: string): Exclude<Kind, 'all'> | 'wait' | 'info' {
  if (msg.includes('✗') || /kelmadi|XATO/.test(msg)) return 'err';
  if (msg.includes('⏸') || msg.includes('↻')) return 'wait';
  if (msg.includes('✓') || msg.startsWith('▶') || msg.startsWith('■') || /MIBda qarzi yoʻq/.test(msg)) return 'ok';
  if (msg.includes('→ SMS')) return 'sms';
  return 'info';
}
const KIND_STYLE: Record<string, { dot: string; text: string }> = {
  err: { dot: 'bg-rose-400', text: 'text-rose-300' },
  wait: { dot: 'bg-amber-400', text: 'text-amber-200' },
  ok: { dot: 'bg-emerald-400', text: 'text-emerald-300' },
  sms: { dot: 'bg-sky-400', text: 'text-slate-300' },
  info: { dot: 'bg-slate-500', text: 'text-slate-400' },
};

function ago(t: useTFn, ms?: number | string | null): string {
  if (!ms) return '—';
  const s = Math.max(0, Math.round((Date.now() - new Date(ms).getTime()) / 1000));
  if (s < 60) return `${s} ${t('s oldin')}`;
  if (s < 3600) return `${Math.floor(s / 60)} ${t('daq oldin')}`;
  return `${Math.floor(s / 3600)} ${t('soat oldin')}`;
}
type useTFn = ReturnType<typeof useT>;

export function MibMonitorModal({ reportId, open, onClose, title }: { reportId: number; open: boolean; onClose: () => void; title?: string }) {
  const t = useT();
  const [lines, setLines] = useState<Line[]>([]);
  const [mon, setMon] = useState<Monitor | null>(null);
  const [kind, setKind] = useState<Kind>('all');
  const [simF, setSimF] = useState<string>(''); // telefonning oxirgi 4 raqami
  const [q, setQ] = useState('');
  const [paused, setPaused] = useState(false);
  const [follow, setFollow] = useState(true);
  const [, tick] = useState(0); // «… oldin» yozuvlari yangilanib tursin
  const lastId = useRef(0);
  const box = useRef<HTMLDivElement>(null);

  const poll = useCallback(async () => {
    const j = await fetch(`/api/mib/logs?report=${reportId}&after=${lastId.current}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
    if (!j || typeof j.lastId !== 'number') return;
    if (j.monitor) setMon(j.monitor);
    if (j.lastId < lastId.current) { lastId.current = 0; setLines([]); return; } // server restart
    if (Array.isArray(j.lines) && j.lines.length) {
      setLines((prev) => {
        const have = new Set(prev.map((l) => l.id));
        const fresh = (j.lines as Line[]).filter((l) => !have.has(l.id));
        return fresh.length ? [...prev, ...fresh].slice(-3000) : prev;
      });
    }
    lastId.current = j.lastId;
  }, [reportId]);

  useEffect(() => { if (!open) return; lastId.current = 0; setLines([]); void poll(); }, [open, poll]);
  useEffect(() => {
    if (!open || paused) return;
    const h = setInterval(() => { void poll(); }, 2000);
    return () => clearInterval(h);
  }, [open, paused, poll]);
  // Taymerlar har soniyada (SMS kutish vaqti, «… oldin»).
  useEffect(() => { if (!open) return; const h = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(h); }, [open]);

  // SIM ro'yxati: ishlayotganlar (+ run statistikasi) — tartib va rang bir xil qolsin.
  const simRows = useMemo(() => {
    const cfg = mon?.sims ?? [];
    // Jonli run bo'lsa — uning statistikasi (u ham saqlanganidan davom etadi); bo'lmasa — oxirgi saqlangani.
    const stats = new Map<string, Partial<SimStat>>(mon?.run
      ? mon.run.sims.map((s) => [s.id, s])
      : Object.entries(mon?.saved?.sims ?? {}).map(([id, v]) => [id, v]));
    // Telefondagi slot tartibida (1-slot chapda); slot noma'lumlar oxirida.
    const ordered = [...cfg].sort((a, b) => (a.slot ?? 9) - (b.slot ?? 9));
    return ordered.filter((s) => s.state === 'on' || stats.has(s.id)).map((s, i) => {
      const st = stats.get(s.id);
      const recv = (mon?.received ?? []).filter((r) => r.key === s.id || (s.slot != null && r.key === `slot:${s.slot}`));
      return {
        ...s, tone: SIM_TONE[i % SIM_TONE.length]!, last4: s.phone.slice(-4), st,
        recv: recv.reduce((a, r) => a + r.count, 0),
        recvAt: recv.map((r) => r.lastAt).filter(Boolean).sort().pop() ?? null,
      };
    });
  }, [mon]);
  const unmatched = useMemo(() => {
    const slots = new Set(simRows.map((s) => (s.slot != null ? `slot:${s.slot}` : '')));
    const ids = new Set(simRows.map((s) => s.id));
    return (mon?.received ?? []).filter((r) => !ids.has(r.key) && !slots.has(r.key));
  }, [mon, simRows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return lines.filter((l) => (kind === 'all' || kindOf(l.msg) === kind) && (!simF || l.msg.includes(`…${simF}`)) && (!needle || l.msg.toLowerCase().includes(needle)));
  }, [lines, kind, simF, q]);
  const counts = useMemo(() => {
    const c = { all: lines.length, sms: 0, ok: 0, err: 0 } as Record<Kind, number>;
    for (const l of lines) { const k = kindOf(l.msg); if (k === 'sms' || k === 'ok' || k === 'err') c[k] += 1; }
    return c;
  }, [lines]);

  useEffect(() => { if (follow && box.current) box.current.scrollTop = box.current.scrollHeight; }, [shown, follow]);
  const onScroll = () => {
    const el = box.current; if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (atBottom !== follow) setFollow(atBottom);
  };

  const download = () => {
    const text = shown.map((l) => `${new Date(l.ts).toISOString()}  ${l.msg}`).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    a.download = `mib-report-${reportId}-log.txt`; a.click(); URL.revokeObjectURL(a.href);
  };

  // Qatorni bezaymiz: SIM nomi («Ucell …2650») — rangli belgi; boshidagi PINFL · ish — ajratilgan.
  const renderMsg = (msg: string) => {
    const tokens = simRows.map((r) => ({ text: `${r.label} …${r.last4}`, tone: r.tone }));
    const out: React.ReactNode[] = [];
    const head = msg.match(/^(\d{14})((?: · \d+)?)/);
    let rest = msg;
    if (head) {
      out.push(<span key="p" className="text-slate-100">{head[1]}</span>);
      if (head[2]) out.push(<span key="w" className="text-slate-500">{head[2]}</span>);
      rest = msg.slice(head[0].length);
    }
    let k = 0;
    while (rest) {
      let best = -1, tok: (typeof tokens)[number] | null = null;
      for (const tk of tokens) { const at = rest.indexOf(tk.text); if (at >= 0 && (best < 0 || at < best)) { best = at; tok = tk; } }
      if (!tok) { out.push(rest); break; }
      out.push(rest.slice(0, best));
      out.push(<span key={`s${k++}`} className={cx('inline-flex items-center rounded border px-1 text-[11px] font-semibold', tok.tone)}>{tok.text}</span>);
      rest = rest.slice(best + tok.text.length);
    }
    return out;
  };

  const run = mon?.run;
  const halt = mon?.halt;
  const state: 'run' | 'wait' | 'idle' = halt?.waiting && mon?.active ? 'wait' : mon?.active ? 'run' : 'idle';
  const tot = simRows.reduce((a, s) => ({ req: a.req + (s.st?.requested ?? 0), ok: a.ok + (s.st?.ok ?? 0), miss: a.miss + (s.st?.miss ?? 0) }), { req: 0, ok: 0, miss: 0 });
  const pr = mon?.progress;
  const pct = pr && pr.total ? Math.round((pr.checked / pr.total) * 1000) / 10 : 0;
  const eta = (m: number | null | undefined) => (m == null ? '—' : m < 60 ? `${m} ${t('daq')}` : m < 48 * 60 ? `${Math.floor(m / 60)} ${t('soat')} ${m % 60} ${t('daq')}` : `${Math.round(m / 60 / 24 * 10) / 10} ${t('kun')}`);
  const statSince = run?.since ?? mon?.saved?.since;
  const onCount = simRows.filter((s) => s.state === 'on').length;

  return (
    <Modal open={open} onClose={onClose} size="2xl" title={title || t('Jonli monitor')} description={t('Avtomator holati, telefon va SIM kartalar, shu hisobot loglari — jonli')}>
      <div className="space-y-4">
        {/* ── Holat qatori ─────────────────────────────────────────── */}
        <div className={cx('flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3',
          state === 'run' ? 'border-emerald-500/30 bg-emerald-500/5' : state === 'wait' ? 'border-amber-500/40 bg-amber-500/10' : 'border-line bg-surface-2/40')}>
          <span className="flex items-center gap-2 text-sm font-semibold">
            {state === 'run' && <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" /></span>}
            {state === 'wait' && <Spinner size={14} />}
            {state === 'idle' && <span className="h-2.5 w-2.5 rounded-full bg-slate-400" />}
            <span className={state === 'run' ? 'text-emerald-700 dark:text-emerald-300' : state === 'wait' ? 'text-amber-700 dark:text-amber-300' : 'text-muted'}>
              {state === 'run' ? t('Avtomator ishlayapti') : state === 'wait' ? t('Ulanish kutilmoqda') : t('Avtomator toʻxtagan')}
            </span>
          </span>
          {run && (
            <span className={cx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
              run.perSim ? 'border-emerald-500/30 text-emerald-700 dark:text-emerald-300' : 'border-amber-500/40 text-amber-700 dark:text-amber-300')}>
              {run.perSim
                ? <>{t('Parallel')}: {onCount} {t('SIM')} × 3 = <b className="tabular-nums">{run.window}</b> {t('ta SMS bir vaqtda')}</>
                : onCount > 1
                  ? <>{t('Umumiy pool')}: <b className="tabular-nums">{run.window}</b> {t('ta SMS bir vaqtda — SIM slotlari oʻrganilmoqda')}</>
                  : <><b className="tabular-nums">{run.window}</b> {t('ta SMS bir vaqtda')}</>}
            </span>
          )}
          {run && <span className="text-xs text-muted">{t('Joriy run')}: {ago(t, run.startedAt)}</span>}
          {tot.req > 0 && (
            <span className="ml-auto text-xs text-muted tabular-nums" title={statSince ? `${t('Hisobot boʻyicha')} · ${new Date(statSince).toLocaleString('ru-RU')}` : undefined}>
              SMS: <b className="text-fg">{n(tot.req)}</b> {t('soʻraldi')} · <b className="text-emerald-600 dark:text-emerald-300">{n(tot.ok)}</b> {t('keldi')} · <b className={tot.miss ? 'text-rose-600 dark:text-rose-300' : 'text-fg'}>{n(tot.miss)}</b> {t('kelmadi')}
            </span>
          )}
          {state === 'wait' && halt && (
            <div className="w-full text-xs text-amber-700 dark:text-amber-300">
              {halt.reason} · {halt.attempt ? `${halt.attempt}-${t('urinish')} · ` : ''}{t('keyingi tekshiruv')} <b className="tabular-nums">{halt.retryAt ? hhmmss(halt.retryAt) : '—'}</b>
            </div>
          )}
          {state === 'idle' && <div className="w-full text-xs text-muted">{t('Hozir run yoʻq — raqamlar va loglar oxirgi saqlangan holatdan.')}</div>}
        </div>

        {/* ── Hisobot bo'yicha UMUMIY progress — pauza/restartdan qat'i nazar (bazadan) ─────────────── */}
        {pr && pr.total > 0 && (
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-line bg-surface p-3 sm:col-span-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-muted">{t('Tekshirildi')}</span>
                <span className="text-lg font-semibold tabular-nums">{n(pr.checked)} <span className="text-sm font-normal text-muted">/ {n(pr.total)}</span> <span className="text-sm text-brand-600 dark:text-brand-400">{pct}%</span></span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-brand-500 transition-[width] duration-500" style={{ width: `${pct}%` }} /></div>
              <div className="mt-1.5 flex justify-between text-[11px] text-muted tabular-nums"><span>{n(pr.pending)} {t('navbatda')}</span><span className={pr.failed ? 'text-rose-600 dark:text-rose-300' : ''}>{n(pr.failed)} {t('xato')}</span></div>
            </div>
            <div className="rounded-xl border border-line bg-surface p-3">
              <div className="text-xs text-muted">{t('Tezlik (oxirgi 15 daq)')}</div>
              <div className="mt-1 text-lg font-semibold tabular-nums">{pr.perMin.toLocaleString('ru-RU')} <span className="text-sm font-normal text-muted">{t('mijoz/daq')}</span></div>
              <div className="text-[11px] text-muted tabular-nums">≈ {n(Math.round(pr.perMin * 60))} {t('mijoz/soat')}</div>
            </div>
            <div className="rounded-xl border border-line bg-surface p-3">
              <div className="text-xs text-muted">{t('Qolgan vaqt (taxminan)')}</div>
              <div className="mt-1 text-lg font-semibold tabular-nums">{pr.pending ? eta(pr.etaMin) : t('tugadi')}</div>
              <div className="text-[11px] text-muted">{t('shu tezlikda')}</div>
            </div>
          </div>
        )}

        {/* ── Telefon: ikkala SIM bitta telefonda — slot tartibida yonma-yon, har SMS uchun jonli taymer ─── */}
        <div className="overflow-hidden rounded-2xl border border-line bg-surface-2/30">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-300">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="6" y="2" width="12" height="20" rx="2.5" /><path d="M11 18h2" /></svg>
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold">{t('Telefon')} · {n(simRows.length)} SIM</div>
              <div className="text-[11px] text-muted">{t('Ikkala SIM bitta telefonda — SMS soʻrovlari orasida 2,5 s oraliq, kod faqat oʻz SIMidagi ishga kiritiladi')}</div>
            </div>
            {unmatched.length > 0 && (
              <span className="ml-auto rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-[11px] text-amber-700 dark:text-amber-300">
                {t('SIMga bogʻlanmagan SMS')}: {unmatched.map((r) => `${r.key === '?' ? t('nomaʼlum') : r.key.replace('slot:', 'SIM ')} ${n(r.count)}`).join(' · ')}
              </span>
            )}
          </div>
          {simRows.length === 0 && <div className="px-4 py-8 text-center text-sm text-muted">{t('SIM ulanmagan — Sozlamalardan qoʻshing.')}</div>}
          <div className={cx('grid divide-line', simRows.length > 1 ? 'md:grid-cols-2 md:divide-x' : '', 'divide-y md:divide-y-0')}>
            {simRows.map((s) => {
              const st = s.st;
              const done = (st?.ok ?? 0) + (st?.miss ?? 0);
              const okPct = done ? Math.round(((st?.ok ?? 0) / done) * 100) : null;
              const benched = !!st?.benchedUntil && st.benchedUntil > Date.now();
              const fresh = st?.lastOkAt && Date.now() - st.lastOkAt < 3 * 60_000;
              const health = s.state !== 'on' ? 'off' : benched ? 'bench' : fresh ? 'ok' : st?.requested ? 'slow' : 'idle';
              const waiting = [...(st?.waiting ?? [])].sort((a, b) => a.at - b.at);
              const tout = st?.timeoutMs ? Math.round(st.timeoutMs / 1000) : null;
              return (
                <div key={s.id} className={cx('p-4', simF === s.last4 && 'bg-brand-500/5')}>
                  {/* sarlavha: slot · nom · raqam · holat */}
                  <div className="flex items-center gap-3">
                    <div className={cx('relative grid h-11 w-9 shrink-0 place-items-center rounded-md border text-[11px] font-bold', s.tone)} style={{ clipPath: 'polygon(0 0, 72% 0, 100% 22%, 100% 100%, 0 100%)' }}>
                      {s.slot ? s.slot : '?'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-semibold">{s.label}</span>
                        <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
                          health === 'ok' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : health === 'bench' ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300' : health === 'slow' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'bg-surface-2 text-muted')}>
                          <span className={cx('h-1.5 w-1.5 rounded-full', health === 'ok' ? 'bg-emerald-500' : health === 'bench' ? 'bg-rose-500' : health === 'slow' ? 'bg-amber-500' : 'bg-slate-400')} />
                          {health === 'ok' ? t('ishlayapti') : health === 'bench' ? `${t('dam')} ${fmtDur(Math.max(0, Math.round((st!.benchedUntil! - Date.now()) / 1000)))}` : health === 'slow' ? t('sekin') : health === 'off' ? t('oʻchiq') : t('kutmoqda')}
                        </span>
                      </div>
                      <div className="text-xs tabular-nums text-muted">…{s.last4} · {s.slot ? `${s.slot}-slot` : t('slot nomaʼlum')}{tout ? ` · ${t('kutish')} ${fmtDur(tout)}` : ''}</div>
                    </div>
                    <button onClick={() => setSimF((v) => (v === s.last4 ? '' : s.last4))} className={cx('shrink-0 rounded-lg border px-2.5 py-1 text-[11px] font-medium', simF === s.last4 ? 'border-brand-500 bg-brand-500 text-white' : 'border-line text-muted hover:text-fg')}>
                      {simF === s.last4 ? t('Filtr ✓') : t('Loglar')}
                    </button>
                  </div>

                  {/* raqamlar */}
                  <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                    {[
                      [n(st?.requested ?? 0), t('soʻraldi'), ''],
                      [n(st?.ok ?? 0), t('keldi'), 'text-emerald-600 dark:text-emerald-300'],
                      [n(st?.miss ?? 0), t('kelmadi'), st?.miss ? 'text-rose-600 dark:text-rose-300' : 'text-muted'],
                      [okPct == null ? '—' : `${okPct}%`, t('aniqlik'), okPct == null ? 'text-muted' : okPct >= 85 ? 'text-emerald-600 dark:text-emerald-300' : okPct >= 60 ? 'text-amber-600 dark:text-amber-300' : 'text-rose-600 dark:text-rose-300'],
                    ].map(([v, l, c]) => (
                      <div key={l} className="rounded-lg border border-line bg-surface py-1.5">
                        <div className={cx('text-base font-semibold tabular-nums', c)}>{v}</div>
                        <div className="text-[10px] text-muted">{l}</div>
                      </div>
                    ))}
                  </div>

                  {/* kutilayotgan SMS — har biri uchun taymer */}
                  <div className="mt-3">
                    <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted">
                      <span>{t('Kutilayotgan SMS')} <b className="tabular-nums text-fg">{waiting.length}</b>/3</span>
                      <span className="tabular-nums">{t('oxirgi kod')}: {ago(t, st?.lastOkAt)}</span>
                    </div>
                    <div className="space-y-1.5">
                      {waiting.length === 0 && <div className="rounded-lg border border-dashed border-line px-3 py-2.5 text-center text-[11px] text-muted">{state === 'run' ? t('Hozir SMS kutilmayapti') : '—'}</div>}
                      {waiting.map((w) => {
                        const el = Math.max(0, (Date.now() - w.at) / 1000);
                        const lim = Math.max(1, (w.until - w.at) / 1000);
                        const frac = Math.min(1, el / lim);
                        return (
                          <div key={`${w.pinfl}-${w.work}`} className="rounded-lg border border-line bg-surface px-2.5 py-1.5">
                            <div className="flex items-center gap-2 text-[11px]">
                              <span className="font-mono tabular-nums text-fg">{w.pinfl}</span>
                              <span className="truncate font-mono text-muted">{w.work}</span>
                              {w.tries > 0 && <span className="rounded bg-amber-500/10 px-1 text-[10px] text-amber-700 dark:text-amber-300">{w.tries}/3</span>}
                              <span className={cx('ml-auto font-mono font-semibold tabular-nums', frac > 0.8 ? 'text-rose-600 dark:text-rose-300' : frac > 0.5 ? 'text-amber-600 dark:text-amber-300' : 'text-fg')}>{fmtDur(Math.round(el))}</span>
                              <span className="font-mono tabular-nums text-muted">/ {fmtDur(Math.round(lim))}</span>
                            </div>
                            <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-2">
                              <div className={cx('h-full rounded-full transition-[width] duration-1000 ease-linear', frac > 0.8 ? 'bg-rose-500' : frac > 0.5 ? 'bg-amber-500' : 'bg-emerald-500')} style={{ width: `${frac * 100}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="mt-2.5 flex flex-wrap justify-between gap-x-3 gap-y-0.5 text-[11px] text-muted">
                    <span>{t('60 daq ichida kelgan SMS')}: <b className="tabular-nums text-fg">{n(s.recv)}</b>{s.recvAt ? ` · ${ago(t, s.recvAt)}` : ''}</span>
                    {statSince && <span className="tabular-nums">{t('hisob')}: {new Date(statSince).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} {t('dan')}</span>}
                  </div>
                  {benched && (
                    <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-800 dark:text-amber-200">
                      <div className="flex items-center justify-between gap-2">
                        <b>{t('Dam olmoqda — SMS kelmay qoldi')}</b>
                        <span className="font-mono font-semibold tabular-nums">{fmtDur(Math.max(0, Math.round((st!.benchedUntil! - Date.now()) / 1000)))}</span>
                      </div>
                      <div className="mt-0.5 opacity-80">{t('Yangi SMS boshqa SIMga soʻralyapti. Dam tugagach bitta sinov SMS — kod kelsa toʻliq qaytadi.')}{st?.restLvl ? ` · ${st.restLvl}-${t('bosqich')} (1 → 3 → 5 → 10 ${t('daq')})` : ''}</div>
                    </div>
                  )}
                  {s.state !== 'on' && <div className="mt-2 rounded-lg bg-surface-2 px-2.5 py-1.5 text-[11px] text-muted">{t('Bu SIM oʻchirilgan — unga SMS soʻralmaydi')}</div>}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Log ──────────────────────────────────────────────────── */}
        <div className="overflow-hidden rounded-xl border border-line">
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-2/40 px-3 py-2">
            <div className="flex gap-0.5 rounded-lg border border-line bg-surface p-0.5">
              {([['all', 'Hammasi'], ['sms', 'SMS'], ['ok', 'Natija'], ['err', 'Xatolar']] as [Kind, string][]).map(([k, lbl]) => (
                <button key={k} onClick={() => setKind(k)}
                  className={cx('rounded-md px-2.5 py-1 text-xs font-medium transition-colors', kind === k ? (k === 'err' ? 'bg-rose-500 text-white' : 'bg-brand-500 text-white') : 'text-muted hover:text-fg')}>
                  {t(lbl)} <span className="tabular-nums opacity-70">{n(counts[k])}</span>
                </button>
              ))}
            </div>
            {simF && <button onClick={() => setSimF('')} className="inline-flex items-center gap-1 rounded-lg border border-brand-500/40 bg-brand-500/10 px-2 py-1 text-xs text-brand-700 dark:text-brand-300">…{simF} <Ico.close size={12} /></button>}
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('PINFL / ish raqami / soʻz…')}
              className="min-w-[160px] flex-1 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs outline-none focus:border-brand-500" />
            <button onClick={() => setPaused((v) => !v)} className={cx('rounded-lg border px-2.5 py-1 text-xs font-medium', paused ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'border-line text-muted hover:text-fg')}>
              {paused ? t('▶ Davom') : t('⏸ Pauza')}
            </button>
            <button onClick={download} className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:text-fg"><Ico.download size={12} /> .txt</button>
          </div>
          <div ref={box} onScroll={onScroll} className="relative h-[46vh] overflow-auto bg-slate-950 px-3 py-2 font-mono text-[12px] leading-relaxed">
            {shown.length === 0
              ? <div className="py-10 text-center text-slate-500">{lines.length ? t('Filtrga mos qator yoʻq') : t('Hozircha log yoʻq — run ishlaganda shu yerda chiqadi')}</div>
              : shown.map((l) => {
                const k = kindOf(l.msg); const ks = KIND_STYLE[k]!;
                return (
                  <div key={l.id} className="flex items-start gap-2 rounded px-1 hover:bg-white/5">
                    <span className="shrink-0 tabular-nums text-slate-500">{hhmmss(l.ts)}</span>
                    <span className={cx('mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full', ks.dot)} />
                    <span className={cx('min-w-0 whitespace-pre-wrap break-words', ks.text)}>{renderMsg(l.msg)}</span>
                  </div>
                );
              })}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-1.5 text-[11px] text-muted">
            <span className="tabular-nums">{n(shown.length)} / {n(lines.length)} {t('qator')} · {t('oldingi run’lar loglari ham saqlanadi')}</span>
            {!follow && <button onClick={() => { setFollow(true); if (box.current) box.current.scrollTop = box.current.scrollHeight; }} className="rounded-md bg-brand-500 px-2 py-0.5 font-medium text-white">{t('↓ Oxiriga')}</button>}
          </div>
        </div>
      </div>
    </Modal>
  );
}
