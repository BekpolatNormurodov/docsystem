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
interface SimStat { id: string; label: string; phone: string; tagged: boolean; requested: number; ok: number; miss: number; inflight: number; lastReqAt?: number; lastOkAt?: number; benchedUntil?: number }
interface Monitor {
  active: boolean;
  run: { startedAt: number; perSim: boolean; window: number; sims: SimStat[] } | null;
  halt: { at: number; reason: string; waiting: boolean; retryAt?: number; attempt?: number } | null;
  sims: { id: string; label: string; phone: string; state: 'pending' | 'on' | 'off'; slot: number | null }[];
  received: { key: string; count: number; used: number; lastAt: string | null }[];
}
type Kind = 'all' | 'sms' | 'ok' | 'err';

const cx = (...c: (string | false | undefined | null)[]) => c.filter(Boolean).join(' ');
const n = (x: number) => (x || 0).toLocaleString('ru-RU');
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

function kindOf(msg: string): Exclude<Kind, 'all'> | 'info' {
  const m = msg.toLowerCase();
  if (/xato|kelmadi|uzildi|yechilmadi|muvaffaqiyatsiz|chetlatildi|javob bermayapti|ochilmadi/.test(m)) return 'err';
  if (/kod keldi|ijro \(|toza|tiklandi|tayyor|slotida ekan/.test(m)) return 'ok';
  if (/sms so'raldi|sms soʻraldi|otp kutil/.test(m)) return 'sms';
  return 'info';
}
const KIND_STYLE: Record<string, { dot: string; text: string; label: string }> = {
  err: { dot: 'bg-rose-400', text: 'text-rose-300', label: 'XATO' },
  ok: { dot: 'bg-emerald-400', text: 'text-emerald-300', label: 'OK' },
  sms: { dot: 'bg-sky-400', text: 'text-slate-200', label: 'SMS' },
  info: { dot: 'bg-slate-500', text: 'text-slate-300', label: '' },
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
    const h = setInterval(() => { void poll(); tick((x) => x + 1); }, 2000);
    return () => clearInterval(h);
  }, [open, paused, poll]);

  // SIM ro'yxati: ishlayotganlar (+ run statistikasi) — tartib va rang bir xil qolsin.
  const simRows = useMemo(() => {
    const cfg = mon?.sims ?? [];
    const stats = new Map((mon?.run?.sims ?? []).map((s) => [s.id, s]));
    return cfg.filter((s) => s.state === 'on' || stats.has(s.id)).map((s, i) => {
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
    for (const l of lines) { const k = kindOf(l.msg); if (k !== 'info') c[k] += 1; }
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

  // Logdagi «… (…1234)» SIM nomini rangli belgiga aylantiramiz.
  const renderMsg = (msg: string) => {
    if (!simRows.length) return msg;
    const parts: React.ReactNode[] = [];
    const re = /([^()→]*?)\s*\(…(\d{4})\)/g;
    let last = 0; let m: RegExpExecArray | null;
    while ((m = re.exec(msg))) {
      const sim = simRows.find((s) => s.last4 === m![2]);
      if (!sim) continue;
      const labelStart = m.index + m[0].indexOf(m[1]!.trimStart());
      parts.push(msg.slice(last, labelStart));
      parts.push(<span key={m.index} className={cx('mx-0.5 inline-flex items-center rounded border px-1 text-[11px] font-semibold', sim.tone)}>{sim.label} …{sim.last4}</span>);
      last = m.index + m[0].length;
    }
    parts.push(msg.slice(last));
    return parts;
  };

  const run = mon?.run;
  const halt = mon?.halt;
  const state: 'run' | 'wait' | 'idle' = halt?.waiting && mon?.active ? 'wait' : mon?.active ? 'run' : 'idle';
  const tot = (run?.sims ?? []).reduce((a, s) => ({ req: a.req + s.requested, ok: a.ok + s.ok, miss: a.miss + s.miss }), { req: 0, ok: 0, miss: 0 });
  const onCount = simRows.filter((s) => s.state === 'on').length;

  return (
    <Modal open={open} onClose={onClose} size="2xl" title={title || t('Jonli monitor')} description={t('Avtomator holati, SIM kartalar va shu hisobot loglari — har 2 soniyada yangilanadi')}>
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
          {run && <span className="text-xs text-muted">{t('Run boshlangan')}: {ago(t, run.startedAt)}</span>}
          {run && tot.req > 0 && (
            <span className="ml-auto text-xs text-muted tabular-nums">
              {t('Jami')}: <b className="text-fg">{n(tot.req)}</b> {t('soʻraldi')} · <b className="text-emerald-600 dark:text-emerald-300">{n(tot.ok)}</b> {t('keldi')} · <b className={tot.miss ? 'text-rose-600 dark:text-rose-300' : 'text-fg'}>{n(tot.miss)}</b> {t('kelmadi')}
            </span>
          )}
          {state === 'wait' && halt && (
            <div className="w-full text-xs text-amber-700 dark:text-amber-300">
              {halt.reason} · {halt.attempt ? `${halt.attempt}-${t('urinish')} · ` : ''}{t('keyingi tekshiruv')} <b className="tabular-nums">{halt.retryAt ? hhmmss(halt.retryAt) : '—'}</b>
            </div>
          )}
          {state === 'idle' && <div className="w-full text-xs text-muted">{t('Hozir run yoʻq — SIM statistikasi run ishlaganda toʻladi. Pastdagi loglar oxirgi run’dan.')}</div>}
        </div>

        {/* ── SIM kartalar ─────────────────────────────────────────── */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {simRows.length === 0 && <div className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted sm:col-span-2 xl:col-span-3">{t('SIM ulanmagan — Sozlamalardan qoʻshing.')}</div>}
          {simRows.map((s) => {
            const st = s.st;
            const done = (st?.ok ?? 0) + (st?.miss ?? 0);
            const pct = done ? Math.round(((st?.ok ?? 0) / done) * 100) : null;
            const benched = !!st?.benchedUntil && st.benchedUntil > Date.now();
            const fresh = st?.lastOkAt && Date.now() - st.lastOkAt < 3 * 60_000;
            const health = s.state !== 'on' ? 'off' : benched ? 'bench' : fresh ? 'ok' : st?.requested ? 'slow' : 'idle';
            return (
              <div key={s.id} className={cx('rounded-xl border bg-surface p-3', simF === s.last4 ? 'border-brand-500 ring-2 ring-brand-500/20' : 'border-line')}>
                <div className="flex items-start gap-2.5">
                  <span className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-lg border text-xs font-bold', s.tone)}>{s.slot ? `S${s.slot}` : s.id.toUpperCase()}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-semibold">{s.label}</span>
                      <span className={cx('h-2 w-2 shrink-0 rounded-full', health === 'ok' ? 'bg-emerald-500' : health === 'bench' ? 'bg-rose-500' : health === 'slow' ? 'bg-amber-500' : 'bg-slate-400')} />
                    </div>
                    <div className="text-xs tabular-nums text-muted">…{s.last4} · {s.slot ? `${t('telefonda')} SIM ${s.slot}` : t('slot hali nomaʼlum')}</div>
                  </div>
                  <button onClick={() => setSimF((v) => (v === s.last4 ? '' : s.last4))} className={cx('shrink-0 rounded-lg px-2 py-1 text-[11px] font-medium', simF === s.last4 ? 'bg-brand-500 text-white' : 'text-muted hover:bg-surface-2 hover:text-fg')}>
                    {simF === s.last4 ? t('Filtr ✓') : t('Loglar')}
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-1.5 text-center">
                  <div className="rounded-lg bg-surface-2/60 py-1.5"><div className="text-base font-semibold tabular-nums">{n(st?.requested ?? 0)}</div><div className="text-[10px] text-muted">{t('soʻraldi')}</div></div>
                  <div className="rounded-lg bg-emerald-500/8 py-1.5"><div className="text-base font-semibold tabular-nums text-emerald-600 dark:text-emerald-300">{n(st?.ok ?? 0)}</div><div className="text-[10px] text-muted">{t('kod keldi')}</div></div>
                  <div className="rounded-lg bg-rose-500/8 py-1.5"><div className={cx('text-base font-semibold tabular-nums', st?.miss ? 'text-rose-600 dark:text-rose-300' : 'text-muted')}>{n(st?.miss ?? 0)}</div><div className="text-[10px] text-muted">{t('kelmadi')}</div></div>
                </div>
                <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div className={cx('h-full rounded-full transition-[width] duration-500', pct == null ? 'bg-transparent' : pct >= 85 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-500' : 'bg-rose-500')} style={{ width: `${pct ?? 0}%` }} />
                </div>
                <div className="mt-2 space-y-0.5 text-[11px] text-muted">
                  <div className="flex justify-between gap-2"><span>{t('Muvaffaqiyat')}</span><b className="tabular-nums text-fg">{pct == null ? '—' : `${pct}%`}</b></div>
                  <div className="flex justify-between gap-2"><span>{t('Hozir kutilmoqda')}</span><b className="tabular-nums text-fg">{n(st?.inflight ?? 0)}</b></div>
                  <div className="flex justify-between gap-2"><span>{t('Oxirgi kod')}</span><span className="tabular-nums">{ago(t, st?.lastOkAt)}</span></div>
                  <div className="flex justify-between gap-2"><span>{t('60 daqiqada kelgan SMS')}</span><span className="tabular-nums">{n(s.recv)}{s.recvAt ? ` · ${ago(t, s.recvAt)}` : ''}</span></div>
                </div>
                {benched && <div className="mt-2 rounded-lg bg-rose-500/10 px-2 py-1 text-[11px] text-rose-700 dark:text-rose-300">{t('SMS ketma-ket kelmadi — vaqtincha chetlatilgan, qaytadi')}: {hhmmss(st!.benchedUntil!)}</div>}
                {s.state !== 'on' && <div className="mt-2 rounded-lg bg-surface-2 px-2 py-1 text-[11px] text-muted">{t('Bu SIM oʻchirilgan — unga SMS soʻralmaydi')}</div>}
              </div>
            );
          })}
        </div>
        {unmatched.length > 0 && (
          <p className="text-[11px] text-muted">
            {t('SIMga bogʻlanmagan SMS (60 daqiqa)')}: {unmatched.map((r) => `${r.key === '?' ? t('nomaʼlum') : r.key.replace('slot:', 'SIM ')} — ${n(r.count)}`).join(' · ')}
            {' '}{t('— avtomator toʻgʻri kodni koʻrib slotni oʻzi oʻrganadi.')}
          </p>
        )}

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
                    <span className={cx('min-w-0 whitespace-pre-wrap break-words', ks.text)}>{renderMsg(l.msg.replace(/^report \d+: /, ''))}</span>
                  </div>
                );
              })}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-1.5 text-[11px] text-muted">
            <span className="tabular-nums">{n(shown.length)} / {n(lines.length)} {t('qator')} · {t('server qayta ishga tushsa log tozalanadi')}</span>
            {!follow && <button onClick={() => { setFollow(true); if (box.current) box.current.scrollTop = box.current.scrollHeight; }} className="rounded-md bg-brand-500 px-2 py-0.5 font-medium text-white">{t('↓ Oxiriga')}</button>}
          </div>
        </div>
      </div>
    </Modal>
  );
}
