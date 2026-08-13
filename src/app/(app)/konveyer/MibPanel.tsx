'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// ── MIB · ijro monitoringi ────────────────────────────────────────────────
// Sud biz foydaga hal qilgan ishlar (COURT_ACCEPTED) + MIB'ga chiqqanlar
// (MIB_SUBMITTED) — shular ustidan ikkita MIB API'si so'raladi:
//   1) Qarzdorlik so'rovi   (ИЖРО ҲУЖЖАТЛАРИ БЎЙИЧА ҚАРЗДОРЛИК) — PINFL bo'yicha
//   2) Ijro monitoringi     (ИЖРО МОНИТОРИНГИ) — ижро ID bo'yicha batafsil
// Ko'rsatilgan ma'lumotlar BAZADAN (real): qarzdor, PINFL, sud ish raqami
// (courtCaseId), holat (stage), qarz. Real MIB API'lari hali ULANMAGAN, shuning
// uchun "tortish" — jonli oqim simulyatsiyasi; davlat ijrochisi va MIB ijro ID
// real API ulangach to'ldiriladi. Hech narsa bazaga yozilmaydi (faqat o'qish).

interface MibCase {
  id: number;
  firmId: number;
  firmName: string;
  clientName: string | null;
  pinfl: string | null;
  kod: string | null;
  stage: string;
  stageLabel: string;
  totalDebt: string;
  courtCaseId: string | null;
  mibRef: string | null;
  courtStatus: string | null;
  courtStatusLabel: string | null;
  courtResult: string | null;
  courtCaseNumber: string | null;
}
type StatusKind = 'granted' | 'process' | 'declined' | 'pending';
interface StatusBucket { key: string; label: string; count: number; debt: string; kind: StatusKind }
interface PullData {
  total: number;
  accepted: number;
  atMib: number;
  totalDebt: string;
  byFirm: { firmId: number; firmName: string; count: number }[];
  byStatus: StatusBucket[];
  granted: number;
  withStatus: number;
  cases: MibCase[];
  capped: boolean;
}

const n = (x: number) => x.toLocaleString('ru-RU');
const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// Holat = real stage. COURT_ACCEPTED = sud qabul qildi (MIB'ga tayyor);
// MIB_SUBMITTED = MIB'ga topshirilgan (ijroda).
const HOLAT: Record<string, { label: string; dot: string; text: string }> = {
  COURT_ACCEPTED: { label: 'Sud qabul qildi', dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-300' },
  MIB_SUBMITTED: { label: "MIB'ga chiqdi", dot: 'bg-teal-500', text: 'text-teal-700 dark:text-teal-300' },
};
const holatOf = (stage: string, fallback: string) => HOLAT[stage] ?? { label: fallback, dot: 'bg-slate-400', text: 'text-muted' };

// ── kichik ikonlar ──────────────────────────────────────────────────────────
const Check = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>
);

function Stat({ label, value, suffix, accent }: { label: string; value: string; suffix?: string; accent?: 'emerald' | 'teal' | 'fg' }) {
  const ring = accent === 'emerald' ? 'border-emerald-500/25 bg-emerald-500/[0.05]'
    : accent === 'teal' ? 'border-teal-500/25 bg-teal-500/[0.05]'
    : 'border-line bg-surface';
  const num = accent === 'emerald' ? 'text-emerald-700 dark:text-emerald-300'
    : accent === 'teal' ? 'text-teal-700 dark:text-teal-300'
    : 'text-fg';
  return (
    <div className={cx('rounded-xl border px-3 py-2.5', ring)}>
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={cx('mt-1 text-xl font-bold leading-none tabular-nums', num)}>
        {value}{suffix && <span className="ml-1 text-[11px] font-medium text-muted">{suffix}</span>}
      </div>
    </div>
  );
}

// Court-status kind → colours (shared by the status buckets + the table rows).
const KIND_UI: Record<StatusKind, { dot: string; text: string; ring: string }> = {
  granted: { dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-300', ring: 'border-emerald-500/30 bg-emerald-500/[0.06]' },
  process: { dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-300', ring: 'border-amber-500/30 bg-amber-500/[0.06]' },
  pending: { dot: 'bg-slate-400', text: 'text-muted', ring: 'border-line bg-surface' },
  declined: { dot: 'bg-rose-500', text: 'text-rose-600 dark:text-rose-300', ring: 'border-rose-500/30 bg-rose-500/[0.06]' },
};
// Per-row court status → kind (mirrors the backend COURT_STATUS_META).
const STATUS_KIND: Record<string, StatusKind> = {
  DECIDED: 'granted', FINISHED: 'granted', IN_PROCESS: 'process', RETURNED: 'declined', DECLINED: 'declined', PENDING: 'pending', CREATED: 'pending', DRAFT: 'pending',
};

function StatusBucketCard({ b }: { b: StatusBucket }) {
  const ui = KIND_UI[b.kind];
  return (
    <div className={cx('rounded-xl border px-3 py-2.5', ui.ring)}>
      <div className="flex items-center gap-1.5">
        <span className={cx('h-2 w-2 shrink-0 rounded-full', ui.dot)} />
        <span className="truncate text-[11px] font-medium text-muted" title={b.label}>{b.label}</span>
      </div>
      <div className={cx('mt-1 text-lg font-bold leading-none tabular-nums', ui.text)}>{n(b.count)}</div>
      <div className="mt-0.5 text-[11px] tabular-nums text-muted">{n(Number(b.debt))} so'm</div>
    </div>
  );
}

// One MIB API station in the pipeline. state: idle → active (so'ralmoqda) → done.
function ApiNode({ index, name, sub, state, count }: { index: number; name: string; sub: string; state: 'idle' | 'active' | 'done'; count: number }) {
  const lit = state !== 'idle';
  return (
    <div className={cx(
      'flex-1 rounded-xl border px-3 py-2.5 transition-colors',
      state === 'active' ? 'border-teal-500/50 bg-teal-500/[0.08]' : state === 'done' ? 'border-teal-500/35 bg-teal-500/[0.05]' : 'border-line bg-surface',
    )}>
      <div className="flex items-center gap-2">
        <span className={cx('grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[11px] font-bold transition-colors',
          lit ? 'bg-teal-600 text-white dark:bg-teal-400 dark:text-slate-900' : 'bg-surface-2 text-muted')}>
          {state === 'done' ? <Check className="h-3.5 w-3.5" /> : index}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[12px] font-semibold leading-tight">{name}</div>
          <div className="truncate text-[10px] text-muted">{sub}</div>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[11px] font-medium tabular-nums">
        {state === 'idle' ? (
          <span className="text-muted">kutilmoqda</span>
        ) : state === 'active' ? (
          <><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal-500" /><span className="text-teal-700 dark:text-teal-300">so'ralmoqda… {n(count)}</span></>
        ) : (
          <span className="text-teal-700 dark:text-teal-300">{n(count)} javob</span>
        )}
      </div>
    </div>
  );
}

// Memoized so the streaming table (rows appended every ~80ms) only renders the newly
// arrived rows — each `r` reference is stable (cases come straight from `data`), so the
// default shallow compare skips the already-shown rows instead of re-reconciling all.
const MibRow = React.memo(function MibRow({ r }: { r: MibCase }) {
  const hasCourt = !!r.courtStatus;
  const cu = hasCourt ? KIND_UI[STATUS_KIND[r.courtStatus!] ?? 'process'] : null;
  const h = holatOf(r.stage, r.stageLabel);
  const caseNo = r.courtCaseNumber || r.courtCaseId;
  return (
    <tr className="animate-fade-in hover:bg-surface-2">
      <td className="px-3 py-2">
        <div className="truncate font-medium" title={r.clientName ?? ''}>{r.clientName || '—'}</div>
        <div className="text-[11px] tabular-nums text-muted">{r.pinfl || '—'} · {r.firmName}</div>
      </td>
      <td className="px-3 py-2">
        <div className="font-mono text-[12px] tabular-nums">{caseNo || '—'}</div>
        <div className="text-[11px] text-muted">{r.mibRef ? `ijro: ${r.mibRef}` : hasCourt ? 'sud ish raqami' : 'ijro ID — MIB API'}</div>
      </td>
      <td className="px-3 py-2">
        {hasCourt ? (
          <span className={cx('inline-flex items-center gap-1.5 text-[11px] font-medium', cu!.text)}>
            <span className={cx('h-1.5 w-1.5 rounded-full', cu!.dot)} />
            {r.courtStatusLabel}
          </span>
        ) : (
          <span className={cx('inline-flex items-center gap-1.5 text-[11px] font-medium', h.text)}>
            <span className={cx('h-1.5 w-1.5 rounded-full', h.dot)} />
            {h.label}
          </span>
        )}
        {r.courtResult && <div className="mt-0.5 max-w-[14rem] truncate text-[10px] text-muted" title={r.courtResult}>{r.courtResult}</div>}
      </td>
      <td className="px-3 py-2 text-right font-semibold tabular-nums">{n(Number(r.totalDebt))}</td>
    </tr>
  );
});

export function MibPanel({ snapshotId, firmId }: { snapshotId?: number; firmId?: number }) {
  const [data, setData] = useState<PullData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(true);

  // "tortish" oqimi (simulyatsiya) holati — ma'lumot bazadan real
  const [running, setRunning] = useState(false);
  const [shown, setShown] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const reqRef = useRef(0);

  const load = useCallback(async () => {
    const my = ++reqRef.current;
    setLoading(true); setErr(null);
    // scope o'zgarsa oqimni ham nolga qaytaramiz
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    setRunning(false); setShown(0);
    try {
      const qs = new URLSearchParams();
      if (snapshotId) qs.set('s', String(snapshotId));
      if (firmId) qs.set('firmId', String(firmId));
      const res = await fetch(`/konveyer/mib/pull${qs.toString() ? `?${qs}` : ''}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Server xatosi (${res.status})`);
      const d: PullData = await res.json();
      if (my !== reqRef.current) return;
      setData(d);
    } catch (e) {
      if (my !== reqRef.current) return;
      setErr(e instanceof Error ? e.message : 'Yuklab bo‘lmadi');
      setData(null);
    } finally {
      if (my === reqRef.current) setLoading(false);
    }
  }, [snapshotId, firmId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  const cases = useMemo(() => data?.cases ?? [], [data]);
  const target = cases.length;

  // Full (uncapped) MIB working list — the interim way to file with MIB by hand until the real API.
  const excelHref = useMemo(() => {
    const qs = new URLSearchParams();
    if (snapshotId) qs.set('s', String(snapshotId));
    if (firmId) qs.set('firmId', String(firmId));
    const s = qs.toString();
    return `/konveyer/mib/excel${s ? `?${s}` : ''}`;
  }, [snapshotId, firmId]);

  const start = () => {
    if (!target) return;
    if (timer.current) clearInterval(timer.current);
    setRunning(true); setShown(0);
    const step = Math.max(1, Math.ceil(target / 50)); // ~50 ta tik → ravon oqim
    timer.current = setInterval(() => {
      setShown((s) => {
        const nx = Math.min(target, s + step);
        if (nx >= target) {
          if (timer.current) { clearInterval(timer.current); timer.current = null; }
          setRunning(false);
        }
        return nx;
      });
    }, 80);
  };
  const stop = () => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    setRunning(false);
  };
  const reset = () => { stop(); setShown(0); };

  const pulled = useMemo(() => cases.slice(0, shown), [cases, shown]);
  const byStage = useMemo(() => {
    let mib = 0, closed = 0;
    for (const r of pulled) { if (r.stage === 'MIB_SUBMITTED') mib++; else if (r.stage === 'CLOSED') closed++; }
    return { mib, closed };
  }, [pulled]);
  const pulledDebt = useMemo(() => pulled.reduce((s, r) => s + Number(r.totalDebt), 0), [pulled]);
  const pct = target ? Math.round((shown / target) * 100) : 0;

  const done = shown >= target && target > 0 && !running;
  // running → so'ralmoqda (pulslaydi); to'xtatilgan/tugagan → «N javob» (tinch).
  const nodeState: 'idle' | 'active' | 'done' = running ? 'active' : shown > 0 ? 'done' : 'idle';

  // segmentli holat-chizig'i uchun ulush
  const segTotal = Math.max(1, shown);
  const seg = (v: number, c: string) => (v > 0 ? <div className={c} style={{ width: `${(v / segTotal) * 100}%` }} /> : null);

  return (
    <div className="card overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center justify-between gap-2 px-5 py-4 text-left">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-teal-500/12 text-teal-600 dark:text-teal-300" aria-hidden>
            <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18" /><path d="M6 21V10l6-4 6 4v11" /><path d="M10 21v-5h4v5" /></svg>
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">MIB · ijro monitoringi</span>
            </div>
            <div className="mt-0.5 truncate text-xs text-muted">Ma'lumotlar bazadan (real) · 2 ta MIB API'sidan tortish</div>
          </div>
        </div>
        <svg className={cx('h-4 w-4 shrink-0 text-muted transition-transform', open && 'rotate-90')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 6 6 6-6 6" /></svg>
      </button>

      {open && (
        <div className="border-t border-line px-5 pb-5 pt-4">
          {loading ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-surface-2" />)}</div>
          ) : err ? (
            <div role="alert" className="flex items-center justify-between gap-2 rounded-xl border border-rose-500/25 bg-rose-500/[0.04] px-3 py-2.5 text-xs">
              <span className="text-rose-500">{err}</span>
              <button onClick={load} className="rounded-lg border border-line px-2.5 py-1 font-medium text-muted hover:border-brand-500/40">Qayta</button>
            </div>
          ) : !data || data.total === 0 ? (
            <div className="rounded-xl border border-dashed border-line bg-surface-2/40 px-3 py-6 text-center text-xs text-muted">
              Bu sana/firma bo'yicha sud foydaga hal qilgan ish topilmadi.
              <div className="mt-1 text-[11px]">Yon paneldagi sanani yoki firmani almashtirib ko'ring.</div>
            </div>
          ) : (
            <>
              {/* to'liq ro'yxatni Excel — MIB'ga qo'lda topshirish uchun (real API ulanmaguncha) */}
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted">MIB'ga topshirish ro'yxati</span>
                <a
                  href={excelHref}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-1.5 text-xs font-semibold text-emerald-700 outline-none transition-colors hover:border-emerald-500/50 hover:bg-emerald-500/[0.1] focus-visible:ring-2 focus-visible:ring-emerald-500/40 dark:text-emerald-300"
                  title="To'liq ro'yxat (Excel) — qarzdor, PINFL, sud ish raqami, holat, sud qarori, qarz. Ekranda ko'pi bilan 500 ta, Excelda hammasi."
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="m9 13 2 3 2-3" /><path d="M11 16v3" /></svg>
                  Excel
                </a>
              </div>

              {/* umumiy holat — real */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Jami ish" value={n(data.total)} />
                <Stat label="Qanoatlantirilgan" value={n(data.granted)} accent="emerald" />
                <Stat label="MIB'da · ijroda" value={n(data.atMib)} accent="teal" />
                <Stat label="Umumiy qarz" value={n(Number(data.totalDebt))} suffix="so'm" accent="fg" />
              </div>
              {data.capped && (
                <div className="mt-2 text-[11px] text-muted">Ro'yxatda ko'pi bilan {n(data.cases.length)} ta ko'rsatiladi (statistika to'liq {n(data.total)} ta bo'yicha).</div>
              )}

              {/* Sud qarori holatlari — real cabinet statuslari, summalar bilan (monitoringning yuragi) */}
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Sud qarori holatlari</span>
                  <span className="text-[11px] tabular-nums text-muted">{n(data.withStatus)} / {n(data.total)} status tortilgan</span>
                </div>
                {data.withStatus === 0 ? (
                  <div className="rounded-xl border border-dashed border-line bg-surface-2/40 px-3 py-4 text-center text-xs text-muted">
                    Sud statuslari hali tortilmagan. «Ulanishlar» dan cabinet.sud.uz ga ulanib statuslarni oling — qanoatlantirilgan / jarayonda / rad holatlari shu yerda summalar bilan chiqadi.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                    {data.byStatus.map((b) => <StatusBucketCard key={b.key} b={b} />)}
                  </div>
                )}
              </div>

              {/* ── 2-API konsoli (signature) ─────────────────────────────── */}
              <div className="mt-4 rounded-2xl border border-line bg-surface-2/30 p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Ijro ma'lumoti · 2 ta MIB API'si</span>
                </div>

                {/* pipeline: API 1 → API 2 */}
                <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[1fr_auto_1fr]">
                  <ApiNode index={1} name="Qarzdorlik so'rovi" sub="ijro hujjatlari · PINFL bo'yicha" state={nodeState} count={shown} />
                  <div className="flex items-center justify-center" aria-hidden>
                    <svg className={cx('h-4 w-4 rotate-90 transition-colors sm:rotate-0', nodeState === 'idle' ? 'text-muted/40' : 'text-teal-500', running && 'animate-pulse')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>
                  </div>
                  <ApiNode index={2} name="Ijro monitoringi" sub="ijro ID bo'yicha batafsil" state={nodeState} count={shown} />
                </div>

                {/* boshqaruv + progress */}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {!running && !done && (
                    <button onClick={start} className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40">
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 3v12" /><path d="m8 11 4 4 4-4" /><path d="M4 21h16" /></svg>
                      Ijro ma'lumotini tortish
                      <span className="rounded-md bg-white/20 px-1.5 py-0.5 text-[11px] font-bold tabular-nums">{n(target)}</span>
                    </button>
                  )}
                  {running && (
                    <>
                      <span className="inline-flex items-center gap-2 rounded-xl bg-teal-500/10 px-3 py-2 text-sm font-semibold text-teal-700 dark:text-teal-300">
                        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-teal-500/40 border-t-teal-600 dark:border-t-teal-300" />
                        Ketyapti… <span className="tabular-nums">{n(shown)}/{n(target)}</span>
                      </span>
                      <button onClick={stop} className="rounded-xl border border-line px-3 py-2 text-sm font-medium text-muted transition-colors hover:border-rose-500/40 hover:text-rose-500">To'xtat</button>
                    </>
                  )}
                  {done && (
                    <>
                      <span className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                        <Check className="h-4 w-4" /> {n(target)} ta tortildi
                      </span>
                      <button onClick={reset} className="rounded-xl border border-line px-3 py-2 text-sm font-medium text-muted transition-colors hover:border-brand-500/40">Qayta tortish</button>
                    </>
                  )}
                  {(running || shown > 0) && (
                    <span className="ml-auto text-xs font-semibold tabular-nums text-muted">{pct}%</span>
                  )}
                </div>
                {(running || shown > 0) && (
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-teal-500 transition-all duration-200" style={{ width: `${pct}%` }} />
                  </div>
                )}

                <div className="mt-3 text-[11px] leading-relaxed text-muted">
                  Ko'rsatilgan qarzdor, PINFL, sud ish raqami, holat va qarz — <b className="font-semibold text-fg">bazadan (real)</b>.
                  Davlat ijrochisi va MIB ijro ID real MIB API ulangach to'ldiriladi. Hech narsa bazaga yozilmaydi.
                </div>
              </div>

              {/* holatlar taqsimoti — real stage bo'yicha */}
              {shown > 0 && (
                <div className="mt-4">
                  <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] text-muted">
                    <span className="font-semibold uppercase tracking-wide">Holatlar taqsimoti</span>
                    <span className="tabular-nums">Tortilgan qarz: <span className="font-semibold text-fg">{n(pulledDebt)}</span> so'm</span>
                  </div>
                  <div className="flex h-2 w-full overflow-hidden rounded-full bg-surface-2">
                    {seg(byStage.mib, 'bg-teal-500')}
                    {seg(byStage.closed, 'bg-slate-400')}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                    <span className="inline-flex items-center gap-1.5 tabular-nums">
                      <span className="h-2 w-2 rounded-full bg-teal-500" /><span className="text-muted">MIB'da · ijroda</span><span className="font-semibold text-fg">{n(byStage.mib)}</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5 tabular-nums">
                      <span className="h-2 w-2 rounded-full bg-slate-400" /><span className="text-muted">Yopilgan</span><span className="font-semibold text-fg">{n(byStage.closed)}</span>
                    </span>
                  </div>
                </div>
              )}

              {/* jonli oqim jadvali — real ma'lumot */}
              {shown > 0 && (
                <div className="mt-4 max-h-96 overflow-auto rounded-xl border border-line">
                  <table className="w-full min-w-[38rem] text-sm">
                    <caption className="sr-only">Tortilgan ijro ma'lumotlari — bazadan (real)</caption>
                    <thead className="sticky top-0 z-10 bg-surface-2/95">
                      <tr>
                        <th colSpan={4} className="border-b border-line bg-teal-500/10 px-3 py-1 text-left text-[10px] font-bold uppercase tracking-wide text-teal-700 dark:text-teal-300">
                          Real ma'lumot · davlat ijrochisi/ijro ID — MIB API ulangach
                        </th>
                      </tr>
                      <tr className="border-b border-line text-[10px] uppercase tracking-wide text-muted">
                        <th scope="col" className="px-3 py-2 text-left font-semibold">Qarzdor</th>
                        <th scope="col" className="px-3 py-2 text-left font-semibold">Sud ish raqami</th>
                        <th scope="col" className="px-3 py-2 text-left font-semibold">Holat</th>
                        <th scope="col" className="px-3 py-2 text-right font-semibold">Qarz</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {pulled.map((r) => <MibRow key={r.id} r={r} />)}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
