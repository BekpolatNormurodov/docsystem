'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// ── MIB · ijro monitoringi ────────────────────────────────────────────────
// Sud biz foydaga hal qilgan ishlar (COURT_ACCEPTED) + MIB'ga chiqqanlar
// (MIB_SUBMITTED) — shular ustidan ikkita MIB API'si so'raladi:
//   1) Qarzdorlik so'rovi   (ИЖРО ҲУЖЖАТЛАРИ БЎЙИЧА ҚАРЗДОРЛИК) — PINFL bo'yicha
//   2) Ijro monitoringi     (ИЖРО МОНИТОРИНГИ) — ижро ID bo'yicha batafsil
// Haqiqiy API'lar hali ULANMAGAN — bu yerda TEST simulyatsiyasi ishlaydi:
// haqiqiy ishlar (PINFL/ism/qarz) ustidan ijro maydonlari (ijro ID, ijrochi,
// holat) deterministik generatsiya qilinadi. Hech narsa bazaga yozilmaydi.

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
  mibRef: string | null;
}
interface PullData {
  total: number;
  accepted: number;
  atMib: number;
  totalDebt: string;
  byFirm: { firmId: number; firmName: string; count: number }[];
  cases: MibCase[];
  capped: boolean;
}

const n = (x: number) => x.toLocaleString('ru-RU');

// ── simulyatsiya lug'atlari (test) ──────────────────────────────────────────
const EXECUTORS = [
  "SULTONOV AHMADJON ZUFARJON O'G'LI",
  "QODIROV BEKZOD SHUHRAT O'G'LI",
  "YUSUPOVA NARGIZA ODIL QIZI",
  "TOSHPO'LATOV JASUR ABDULLA O'G'LI",
  "RAHIMOV OYBEK NODIR O'G'LI",
  "ISMOILOVA DILNOZA FARHOD QIZI",
  "XALILOV SARDOR G'AYRAT O'G'LI",
  "MADAMINOV SHERZOD BAXODIR O'G'LI",
];
const DEPARTMENTS = [
  'Oltinsoy tumani', 'Chirchiq shahar', 'Yunusobod tumani', "Mirzo Ulug'bek tumani",
  "Sirg'ali tumani", 'Yashnobod tumani', 'Bektemir tumani', 'Uchtepa tumani',
];
type Status = { key: 'PROCEEDING' | 'INPROCESS' | 'DONE'; label: string };
const STATUS: Record<Status['key'], Status> = {
  PROCEEDING: { key: 'PROCEEDING', label: 'Ish yuritishga olindi' }, // ИШ ЮРИТУВГА ОЛИНДИ
  INPROCESS: { key: 'INPROCESS', label: 'Jarayonda' }, // Жараёнда
  DONE: { key: 'DONE', label: 'Ijro tugallandi' },
};
const statusFor = (seed: number): Status => {
  const r = seed % 10;
  return r < 6 ? STATUS.PROCEEDING : r < 9 ? STATUS.INPROCESS : STATUS.DONE;
};
const STATUS_TONE: Record<Status['key'], string> = {
  PROCEEDING: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
  INPROCESS: 'bg-amber-500/12 text-amber-700 dark:text-amber-300',
  DONE: 'bg-sky-500/12 text-sky-700 dark:text-sky-300',
};

interface PulledRec extends MibCase {
  ijroId: string;
  docNumber: string;
  executor: string;
  department: string;
  status: Status;
}
const enrich = (c: MibCase): PulledRec => ({
  ...c,
  ijroId: '1907260' + (3106500 + c.id).toString().padStart(7, '0'),
  docNumber: `2-1004-260${(c.id % 5) + 9}/${36000 + (c.id % 4000)}`,
  executor: EXECUTORS[c.id % EXECUTORS.length],
  department: DEPARTMENTS[(c.id >> 2) % DEPARTMENTS.length],
  status: statusFor(c.id),
});

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className={`rounded-xl border border-line px-3 py-2 ${tone ?? 'bg-surface'}`}>
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 text-lg font-bold tabular-nums leading-none">{value}</div>
    </div>
  );
}

export function MibPanel({ snapshotId, firmId }: { snapshotId?: number; firmId?: number }) {
  const [data, setData] = useState<PullData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(true);

  // simulyatsiya holati
  const [running, setRunning] = useState(false);
  const [shown, setShown] = useState(0); // nechta yozuv "tortildi"
  const [phase, setPhase] = useState(0); // API bosqichi label uchun
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const reqRef = useRef(0);

  const load = useCallback(async () => {
    const my = ++reqRef.current;
    setLoading(true); setErr(null);
    // scope o'zgarsa simulyatsiyani ham nolga qaytaramiz
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

  const enriched = useMemo(() => (data?.cases ?? []).map(enrich), [data]);
  const target = enriched.length;

  const start = () => {
    if (!target) return;
    if (timer.current) clearInterval(timer.current);
    setRunning(true); setShown(0); setPhase(0);
    const step = Math.max(1, Math.ceil(target / 50)); // ~50 ta tik → ravon oqim
    timer.current = setInterval(() => {
      setPhase((p) => p + 1);
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

  const pulled = enriched.slice(0, shown);
  const byStatus = useMemo(() => {
    const c = { PROCEEDING: 0, INPROCESS: 0, DONE: 0 };
    for (const r of pulled) c[r.status.key]++;
    return c;
  }, [pulled]);
  const pulledDebt = useMemo(() => pulled.reduce((s, r) => s + Number(r.totalDebt), 0), [pulled]);
  const pct = target ? Math.round((shown / target) * 100) : 0;
  const phaseLabel = phase % 2 === 0 ? "API 1 · Qarzdorlik so'rovi" : 'API 2 · Ijro monitoringi';

  return (
    <div className="card p-5">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center justify-between gap-2 text-left">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">MIB · ijro monitoringi</span>
            <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">Simulyatsiya · test</span>
          </div>
          <div className="mt-0.5 truncate text-xs text-muted">
            Sud foydaga hal qilgan + MIB'dagi ishlar bo'yicha 2 ta API'dan ijro ma'lumoti
          </div>
        </div>
        <svg className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 6 6 6-6 6" /></svg>
      </button>

      {open && (
        <div className="mt-4">
          {/* test ogohlantirishi */}
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.05] px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200">
            <svg className="mt-0.5 h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>
            <span>Haqiqiy MIB API'lari <b>hali ulanmagan</b>. Bu — test simulyatsiyasi: haqiqiy ishlar (PINFL, ism, qarz) ustidan ijro maydonlari (ijro ID, davlat ijrochisi, holat) namuna sifatida generatsiya qilinadi. Bazaga hech narsa yozilmaydi.</span>
          </div>

          {loading ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-surface-2" />)}</div>
          ) : err ? (
            <div role="alert" className="flex items-center justify-between gap-2 rounded-lg border border-rose-500/25 bg-rose-500/[0.04] px-3 py-2 text-xs">
              <span className="text-rose-500">{err}</span>
              <button onClick={load} className="rounded border border-line px-2 py-0.5 font-medium text-muted hover:border-brand-500/40">Qayta</button>
            </div>
          ) : !data || data.total === 0 ? (
            <div className="rounded-xl border border-line bg-surface-2/40 px-3 py-4 text-center text-xs text-muted">
              Bu sana/firma bo'yicha sud foydaga hal qilgan ish yo'q (COURT_ACCEPTED yoki MIB_SUBMITTED topilmadi).
              <div className="mt-1 text-[11px]">Yon paneldagi sanani yoki firmani almashtirib ko'ring.</div>
            </div>
          ) : (
            <>
              {/* umumiy holat */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Jami ish" value={n(data.total)} />
                <Stat label="Sud qabul qildi" value={n(data.accepted)} tone="bg-emerald-500/[0.06]" />
                <Stat label="MIB'da (ijroda)" value={n(data.atMib)} tone="bg-teal-500/[0.06]" />
                <Stat label="Umumiy qarz" value={n(Number(data.totalDebt))} />
              </div>
              {data.capped && (
                <div className="mt-2 text-[11px] text-muted">Ro'yxatda ko'pi bilan {n(data.cases.length)} ta ko'rsatiladi (statistika to'liq {n(data.total)} ta bo'yicha).</div>
              )}

              {/* boshqaruv */}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {!running && shown < target && (
                  <button onClick={start} className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-teal-700">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 3v12" /><path d="m8 11 4 4 4-4" /><path d="M4 21h16" /></svg>
                    Ijro ma'lumotini tortish ({n(target)})
                  </button>
                )}
                {running && (
                  <>
                    <span className="inline-flex items-center gap-2 rounded-xl bg-teal-500/10 px-3 py-2 text-sm font-semibold text-teal-700 dark:text-teal-300">
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-teal-500/40 border-t-teal-600 dark:border-t-teal-300" />
                      Ketyapti… {n(shown)}/{n(target)}
                    </span>
                    <button onClick={stop} className="rounded-xl border border-line px-3 py-2 text-sm font-medium text-muted hover:border-rose-500/40 hover:text-rose-500">To'xtat</button>
                  </>
                )}
                {!running && shown >= target && target > 0 && (
                  <>
                    <span className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>
                      {n(target)} ta tortildi
                    </span>
                    <button onClick={reset} className="rounded-xl border border-line px-3 py-2 text-sm font-medium text-muted hover:border-brand-500/40">Qayta tortish</button>
                  </>
                )}
              </div>

              {/* progress */}
              {(running || shown > 0) && (
                <div className="mt-3">
                  <div className="mb-1 flex items-center justify-between text-[11px] tabular-nums text-muted">
                    <span>{running ? phaseLabel : 'Tortildi'}</span>
                    <span>{pct}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-teal-500 transition-all duration-200" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )}

              {/* tortilgan yozuvlar bo'yicha statistika */}
              {shown > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
                  <span className={`rounded-lg px-2 py-1 font-medium tabular-nums ${STATUS_TONE.PROCEEDING}`}>Ish yuritishga olindi: {n(byStatus.PROCEEDING)}</span>
                  <span className={`rounded-lg px-2 py-1 font-medium tabular-nums ${STATUS_TONE.INPROCESS}`}>Jarayonda: {n(byStatus.INPROCESS)}</span>
                  <span className={`rounded-lg px-2 py-1 font-medium tabular-nums ${STATUS_TONE.DONE}`}>Tugallandi: {n(byStatus.DONE)}</span>
                  <span className="rounded-lg bg-surface-2 px-2 py-1 font-medium tabular-nums text-muted">Qarz: {n(pulledDebt)} so'm</span>
                </div>
              )}

              {/* jonli oqim jadvali */}
              {shown > 0 && (
                <div className="mt-3 max-h-96 overflow-auto rounded-xl border border-line">
                  <table className="w-full min-w-[44rem] text-sm">
                    <caption className="sr-only">Tortilgan ijro ma'lumotlari (simulyatsiya)</caption>
                    <thead className="sticky top-0 z-10 bg-surface-2/90 backdrop-blur">
                      <tr className="border-b border-line text-[10px] uppercase tracking-wide text-muted">
                        <th scope="col" className="px-3 py-2 text-left font-semibold">Qarzdor</th>
                        <th scope="col" className="px-3 py-2 text-left font-semibold">Ijro ID</th>
                        <th scope="col" className="px-3 py-2 text-left font-semibold">Davlat ijrochisi</th>
                        <th scope="col" className="px-3 py-2 text-left font-semibold">Holat</th>
                        <th scope="col" className="px-3 py-2 text-right font-semibold">Qarz</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {pulled.map((r) => (
                        <tr key={r.id} className="animate-fade-in hover:bg-surface-2">
                          <td className="px-3 py-2">
                            <div className="truncate font-medium" title={r.clientName ?? ''}>{r.clientName || '—'}</div>
                            <div className="text-[11px] tabular-nums text-muted">{r.pinfl || '—'} · {r.firmName}</div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="tabular-nums">{r.ijroId}</div>
                            <div className="text-[11px] text-muted">{r.docNumber}</div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="max-w-[13rem] truncate text-xs" title={r.executor}>{r.executor}</div>
                            <div className="text-[11px] text-muted">{r.department}</div>
                          </td>
                          <td className="px-3 py-2">
                            <span className={`inline-block rounded-md px-1.5 py-0.5 text-[11px] font-medium ${STATUS_TONE[r.status.key]}`}>{r.status.label}</span>
                          </td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums">{n(Number(r.totalDebt))}</td>
                        </tr>
                      ))}
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
