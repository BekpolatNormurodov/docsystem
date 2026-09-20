'use client';
import { useCallback, useEffect, useState } from 'react';
import { useT } from '@/lib/i18n/client';

// 24/7 AVTOMAT QORALAMA («Go») — boshqaruv + monitoring (sud bo'limi, «Qoralama (1 qadam)» tabi).
//
// «Go» yoqilsa worker to'xtovsiz tayyor ishlar uchun ADOLAT «Murojaatlarim»da qoralama (suitMode:
// save-suit, send-to-court YO'Q) tayyorlaydi — firma-ketma-firma, 24/7. Panel: yoqilgan-o'chirilgani,
// hozir QAYSI partiya ketmoqda (qoralama / 3-tab yuborishi / eski real), har firmaning OXIRGI
// qoralama partiyasi natijasi (xato bo'lsa sababi bilan) va portal bloki (backoff) — 2026-09-19:
// ilgari Go xatolari, to'xtab qolgan firma va portal kutishi hech qayerda ko'rinmasdi.

const n = (x: number) => x.toLocaleString('ru-RU');
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

type JobKind = 'draft' | 'suit' | 'real' | 'send';
interface LastBatch { jobId: number; kind: JobKind; status: string; message: string | null; total: number; progress: number; finishedAt: string }
interface Tally { total: number; draftReady: number; submitted: number; queued: number }
interface FirmRow extends Tally { firmId: number; firmName: string; sendable: number; active: boolean; paused: boolean; lastBatch?: LastBatch | null }
interface CourtRow extends Tally { courtId: number; courtName: string; sendable: number }
interface Status {
  on: boolean;
  active: { jobId: number; status: string; progress: number; total: number; firmName: string | null; kind?: JobKind | null; draftMode: boolean; message: string | null } | null;
  firms: FirmRow[];
  courts: CourtRow[];
  backoff?: { nextAttemptAt: string | null };
}

// Partiya turi yorlig'i — literal sinflar (Tailwind JIT interpolatsiyani ko'rmaydi).
const KIND_META: Record<JobKind, { label: string; hint: string; cls: string }> = {
  suit: { label: 'Qoralama', hint: 'ADOLAT «Murojaatlarim»da qoralama tayyorlanmoqda — sudga yuborilmaydi', cls: 'bg-teal-500/15 text-teal-700 dark:text-teal-300' },
  draft: { label: 'Qoralama (eski usul)', hint: '«Qoralamalar» wizard qoralamasi (save-suit’siz) — sudga yuborilmaydi', cls: 'bg-teal-500/15 text-teal-700 dark:text-teal-300' },
  send: { label: 'Sudga o‘tkazish', hint: '«Sudga o‘tkazish» tabidan E-IMZO bilan real yuborish ketmoqda — Go u tugagach davom etadi', cls: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300' },
  real: { label: 'Real yuborish (eski)', hint: 'Eski real yuborish partiyasi — Go u tugagach davom etadi', cls: 'bg-rose-500/15 text-rose-700 dark:text-rose-300' },
};

// Oxirgi partiya holati: FAILED — hech biri chiqmadi (ko'pincha sessiya/claimant — fatal);
// DONE + «XATO» — qisman; DONE — hammasi joyida. CANCELED — operator to'xtatgan.
function batchTone(b: LastBatch): 'ok' | 'partial' | 'failed' | 'canceled' {
  if (b.status === 'FAILED') return 'failed';
  if (b.status === 'CANCELED') return 'canceled';
  return /XATO/i.test(b.message ?? '') ? 'partial' : 'ok';
}
const BATCH_CLS: Record<ReturnType<typeof batchTone>, string> = {
  ok: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  partial: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  failed: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  canceled: 'bg-slate-500/12 text-slate-600 dark:text-slate-300',
};
const BATCH_LABEL: Record<ReturnType<typeof batchTone>, string> = {
  ok: 'oxirgi partiya: tayyor',
  partial: 'oxirgi partiya: qisman xato',
  failed: 'oxirgi partiya: xato',
  canceled: 'oxirgi partiya: to‘xtatilgan',
};

function Bar({ sendable, ready, queued, submitted, total }: { sendable: number; ready: number; queued: number; submitted: number; total: number }) {
  const pct = (x: number) => (total ? Math.round((x / total) * 100) : 0);
  // Legend 4 rangni ko'rsatardi, chiziq esa 3 tasini chizardi («tayyor» yo'q edi) — endi mos.
  // TARTIB legend bilan bir xil: tayyor → navbatda → qoralama → sudda (2026-09-20: teskari edi).
  return (
    <span className="flex h-1.5 min-w-[60px] flex-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
      <span className="h-full bg-emerald-500" style={{ width: `${pct(sendable)}%` }} />
      <span className="h-full bg-amber-500" style={{ width: `${pct(queued)}%` }} />
      <span className="h-full bg-teal-500" style={{ width: `${pct(ready)}%` }} />
      <span className="h-full bg-indigo-500" style={{ width: `${pct(submitted)}%` }} />
    </span>
  );
}

/** Bitta raqam + uning NOMI. Chip emas: chiplar bir-biriga o'xshab ketardi va operator qaysi son
 *  nimani bildirishini ajrata olmasdi (2026-09-20 operator izohi: «data kop aralawb ketgan»). */
function Metric({ label, value, tone, hint }: { label: string; value: number; tone: 'emerald' | 'amber' | 'teal' | 'rose' | 'muted'; hint: string }) {
  const t = useT();
  const cls = tone === 'emerald' ? 'text-emerald-600 dark:text-emerald-400'
    : tone === 'amber' ? 'text-amber-600 dark:text-amber-400'
    : tone === 'teal' ? 'text-teal-600 dark:text-teal-400'
    : tone === 'rose' ? 'text-rose-600 dark:text-rose-400' : 'text-fg';
  return (
    <div className="min-w-[84px]" title={t(hint)}>
      <div className="text-[10px] uppercase tracking-wide text-muted">{t(label)}</div>
      <div className={`text-[15px] font-semibold tabular-nums ${cls}`}>{n(value)}</div>
    </div>
  );
}

export default function DraftAutoPanel({ visible = true, embedded = false }: { visible?: boolean; /** Tashqi kartaning ichida — o'z ramkasini chizmaydi */ embedded?: boolean }) {
  const t = useT();
  const [data, setData] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/konveyer/court-draft-auto', { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      setData(await r.json());
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('holat o‘qilmadi'));
    }
  }, []);

  useEffect(() => {
    if (!visible) return; // sud tabi yashirin — umuman so'ramaymiz (ochilganda darhol yuklanadi)
    void load();
    // Yashirin oynada (boshqa brauzer tabi) so'ramaymiz — GET butun courtReadiness'ni hisoblaydi
    // (og'ir), 12 soniyada bir har ochiq oynadan kelardi.
    const id = setInterval(() => { if (typeof document === 'undefined' || !document.hidden) void load(); }, 12000);
    return () => clearInterval(id);
  }, [load, visible]);

  const toggle = async () => {
    if (!data || busy) return;
    setBusy(true);
    try {
      const r = await fetch('/konveyer/court-draft-auto', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ on: !data.on }),
      });
      if (r.ok) { const d = await r.json(); setData((p) => (p ? { ...p, on: d.on === true } : p)); }
    } catch { /* tarmoq — holat o'zgarmaydi */ } finally { setBusy(false); void load(); }
  };

  // Bitta firmani to'xtatish/davom ettirish (umumiy «Go»dan mustaqil). Pauzaga qo'yilgan firma
  // avto-qoralamada chetlab o'tiladi — boshqa firmalar ketaveradi.
  const [firmBusy, setFirmBusy] = useState<number | null>(null);
  const toggleFirm = async (firmId: number, paused: boolean) => {
    if (firmBusy) return;
    setFirmBusy(firmId);
    // Optimistik: darhol ko'rsatamiz.
    setData((p) => (p ? { ...p, firms: p.firms.map((f) => (f.firmId === firmId ? { ...f, paused: !paused } : f)) } : p));
    try {
      await fetch('/konveyer/court-queue/pause', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused: !paused, firmId }),
      });
    } catch { /* tarmoq — keyingi pollда to'g'rilanadi */ } finally { setFirmBusy(null); void load(); }
  };

  // Karta ichida (embedded) yuklanayotganda bo'sh ramka turib qolmasin — skelet chiziladi.
  if (!data && !err) return embedded ? <div className="h-16 animate-pulse bg-surface-2" /> : null;
  const on = data?.on === true;
  const active = data?.active ?? null;
  // Eski javob (kind'siz) — draftMode'dan taxmin qilamiz.
  const activeKind: JobKind | null = active ? (active.kind ?? (active.draftMode ? 'suit' : 'real')) : null;
  const totalDraftReady = (data?.firms ?? []).reduce((s, f) => s + f.draftReady, 0);
  // «Tayyor» = hujjati to'liq, hali qoralama/yuborilmagan — «Go»da AYNAN shular qoralama qilinadi.
  const totalSendable = (data?.firms ?? []).reduce((s, f) => s + (f.sendable ?? 0), 0);
  // «Navbatda» = allaqachon partiyaga olingan, ayni damda qoralamaga aylantirilyapti. Buni
  // yuqorida ko'rsatmasak, «Go» hammasini navbatga tortib olganda firma «Tayyor 0» ko'rinib,
  // uchayotgan ishlar g'oyib bo'lganday chalkashtirardi (pastdagi kartada 199, yuqorida 0).
  const totalQueued = (data?.firms ?? []).reduce((s, f) => s + (f.queued ?? 0), 0);
  // Oxirgi qoralama partiyasi yiqilgan firmalar — sarlavhada alohida (Monitoring yopiq bo'lsa ham).
  const failedFirms = (data?.firms ?? []).filter((f) => f.lastBatch && batchTone(f.lastBatch) === 'failed');
  const nextAttemptAt = data?.backoff?.nextAttemptAt ?? null;

  return (
    <div className={embedded ? '' : `rounded-xl border transition-colors ${on ? 'border-teal-500/45 bg-teal-500/[0.05]' : 'border-line bg-surface'}`}>
      {/* 1-QATOR: holat + asosiy tugmalar. Faqat shu yerda «nima bo'layapti» deyiladi. */}
      <div className="flex flex-wrap items-center gap-3 p-3">
        <span className="relative mt-1 flex h-2.5 w-2.5 shrink-0 self-start" aria-hidden>
          {on && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-500/70" />}
          <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${on ? 'bg-teal-500' : 'bg-slate-400'}`} />
        </span>
        <div className="min-w-[220px] flex-1">
          <div className="text-[13px] font-semibold">
            <span className={on ? 'text-teal-700 dark:text-teal-300' : 'text-fg'}>
              {t('24/7 avtomat qoralama')} {on ? t('— ishlamoqda') : t('— o‘chiq')}
            </span>
          </div>
          {/* Nima qilishini BIR jumlada — tugmalar nimaga tegishli ekani shu yerdan aniq bo'ladi. */}
          <p className="mt-0.5 text-[11px] leading-snug text-muted">
            {t('Hujjati to‘liq ishlardan ADOLAT «Murojaatlarim»da qoralama tayyorlaydi. Sudga YUBORMAYDI — yuborish «Sudga o‘tkazish» tabida.')}
          </p>
        </div>
        <button
          onClick={toggle}
          disabled={busy || !data}
          title={on ? t('Yangi qoralama partiyalari boshlanmaydi (ketayotgani tugaydi)') : t('Tayyor ishlar uchun ADOLAT «Murojaatlarim»da qoralama tayyorlash — 24/7, sudga yuborilmaydi')}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 disabled:opacity-50 ${
            on
              ? 'border-rose-500/45 text-rose-600 hover:bg-rose-500/10 focus-visible:ring-rose-500/30 dark:text-rose-300'
              : 'border-teal-500/50 bg-teal-500/10 text-teal-700 hover:bg-teal-500/[0.18] focus-visible:ring-teal-500/30 dark:text-teal-300'
          }`}
        >
          {busy ? '…' : on ? t('Avtomatni to‘xtatish') : t('Avtomatni yoqish (24/7)')}
        </button>
        <button onClick={() => setOpen((v) => !v)} aria-expanded={open}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-[11px] font-medium text-muted outline-none transition-colors hover:border-teal-500/40 hover:text-fg focus-visible:ring-2 focus-visible:ring-teal-500/30">
          {t('Firma kesimi')}
          <svg className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
        </button>
      </div>

      {/* 2-QATOR: RAQAMLAR — har biri nomi bilan, bir xil ma'noda (rang ham). */}
      {/* RAQAMLAR QAMROVI: bu yerdagi sonlar BARCHA firma + oxirgi hisobot bo'yicha (route firma/snapshot
          filtrini qabul qilmaydi), yuqoridagi «Tayyor/Sudda» kartalari esa TANLANGAN firma bo'yicha. Bir xil
          so'z, boshqa qamrov — shuning uchun qamrov yozib qo'yiladi (2026-09-20 operator izohi). */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line px-3 py-2">
        <div className="min-w-[84px] self-center text-[10px] uppercase tracking-wide text-muted" title={t('Quyidagi sonlar barcha firmalar va oxirgi hisobot bo‘yicha')}>
          {t('Barcha firmalar')}
        </div>
        <Metric label="Tayyor" value={totalSendable} tone="emerald" hint="Hujjati to‘liq, hali navbatga olinmagan — avtomat shulardan boshlaydi" />
        <Metric label="Navbatda" value={totalQueued} tone="amber" hint="Partiyaga olingan — ayni damda qoralama tayyorlanmoqda" />
        <Metric label="Qoralama tayyor" value={totalDraftReady} tone="teal" hint="ADOLAT «Murojaatlarim»da tayyor turibdi — «Sudga o‘tkazish» tabida yuboriladi" />
        {/* HOZIR nima ishlanmoqda — u ham nomi bilan (qolgan ustunlar kabi), progress chizig'i ko'rinadigan. */}
        {active && activeKind && (
          <div className="w-full min-w-0 sm:ml-auto sm:w-auto">
            <div className="text-[10px] uppercase tracking-wide text-muted">{t('Hozir ketmoqda')}</div>
            <div className="flex items-center gap-2 text-[11px]">
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${KIND_META[activeKind].cls}`} title={t(KIND_META[activeKind].hint)}>{t(KIND_META[activeKind].label)}</span>
              <span className="truncate font-medium">{active.firmName}</span>
              <span className="shrink-0 tabular-nums text-muted">{n(active.progress)}/{n(active.total)} {t('ta ish')}</span>
              {active.total > 0 && (
                <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-sky-500/20" aria-hidden>
                  {/* 2/228 = 1% → 0.6px, ya'ni ko'rinmasdi: eng kami 2%. */}
                  <span className="block h-full rounded-full bg-sky-500" style={{ width: `${Math.max(2, Math.min(100, Math.round((active.progress / active.total) * 100)))}%` }} />
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Sabab/ogohlantirish qatorlari — faqat kerak bo'lganda. */}
      {(active && (activeKind === 'send' || activeKind === 'real') && on) || nextAttemptAt || err || failedFirms.length > 0 ? (
        <div className="space-y-1 border-t border-line bg-amber-500/[0.06] px-3 py-2">
          {failedFirms.length > 0 && (
            <button type="button" onClick={() => setOpen(true)}
              className="block text-left text-[11px] leading-snug text-rose-700 underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-rose-500/30 dark:text-rose-300"
              title={failedFirms.map((f) => `${f.firmName}: ${f.lastBatch?.message ?? ''}`).join('\n')}>
              {t('Oxirgi qoralama partiyasi')} {n(failedFirms.length)} {t('ta firmada xato bergan — «Firma kesimi»dan sababini ko‘ring')}
            </button>
          )}
          {active && (activeKind === 'send' || activeKind === 'real') && on && (
            <p className="text-[11px] leading-snug text-indigo-700 dark:text-indigo-300">{t('Hozir sudga yuborish partiyasi ketmoqda — bir vaqtda bitta partiya ishlaydi, avtomat u tugagach o‘zi davom etadi.')}</p>
          )}
          {nextAttemptAt && (
            <p className="text-[11px] leading-snug text-amber-700 dark:text-amber-300" role="status">
              {t('Portal vaqtincha bloklagan (ketma-ket xatolar) — navbatni avtomat davom ettirish')} {hhmm(nextAttemptAt)} {t('dan keyin qayta uriniladi.')}
            </p>
          )}
          {err && <p className="text-[11px] text-rose-500" role="alert">{t('Holat yangilanmadi:')} {err}</p>}
        </div>
      ) : null}

      {open && data && (
        <div className="grid gap-3 border-t border-line p-3 md:grid-cols-2">
          {/* FIRMA kesimida */}
          <div>
            <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold text-muted">
              <span>{t('Firma kesimida')}</span>
              <span className="ml-auto flex items-center gap-2 text-[10px] font-normal">
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" />{t('tayyor')}</span>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" />{t('navbatda')}</span>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-teal-500" />{t('qoralama')}</span>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-indigo-500" />{t('sudda')}</span>
              </span>
            </div>
            <ul className="space-y-1">
              {data.firms.map((f) => {
                const lb = f.lastBatch ?? null;
                const tone = lb ? batchTone(lb) : null;
                return (
                  <li key={f.firmId} className={`rounded-lg px-2 py-1.5 text-[11px] ${f.paused ? 'bg-rose-500/[0.06] opacity-70' : f.active ? 'bg-sky-500/10 ring-1 ring-inset ring-sky-500/35' : 'bg-surface-2'}`}>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleFirm(f.firmId, f.paused)}
                        disabled={firmBusy === f.firmId}
                        title={f.paused ? t('Bu firmani davom ettirish (qoralama va «Sudga o‘tkazish»)') : t('Bu firmani to‘xtatish — qoralama HAM, «Sudga o‘tkazish» HAM to‘xtaydi (boshqa firmalar ketaveradi)')}
                        aria-label={f.paused ? t('Bu firmani davom ettirish (qoralama va «Sudga o‘tkazish»)') : t('Bu firmani to‘xtatish — qoralama HAM, «Sudga o‘tkazish» HAM to‘xtaydi (boshqa firmalar ketaveradi)')}
                        className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded outline-none transition-colors focus-visible:ring-2 disabled:opacity-40 ${f.paused ? 'text-rose-600 hover:bg-rose-500/15 focus-visible:ring-rose-500/30 dark:text-rose-300' : 'text-muted hover:bg-surface hover:text-fg focus-visible:ring-teal-500/30'}`}
                      >
                        {f.paused
                          ? <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg>
                          : <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>}
                      </button>
                      <span className={`min-w-0 flex-1 truncate font-medium ${f.paused ? 'text-muted' : f.active ? 'text-sky-700 dark:text-sky-300' : ''}`} title={f.firmName}>{f.firmName}</span>
                      {f.active && !f.paused && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded bg-sky-500/15 px-1 py-0.5 text-[9px] font-semibold text-sky-700 dark:text-sky-300" title={t('Ayni damda ishlanyapti')}>
                          <span className="relative flex h-1.5 w-1.5" aria-hidden>
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-500/70" />
                            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-sky-500" />
                          </span>
                          {/* Progress yuqoridagi «Hozir ketmoqda» ustunida — bu yerda takrorlanmaydi. */}
                          {t('ketyapti')}
                        </span>
                      )}
                      {f.paused && <span className="shrink-0 rounded bg-rose-500/15 px-1 py-0.5 text-[9px] font-medium text-rose-700 dark:text-rose-300">{t('pauza')}</span>}
                      <Bar sendable={f.sendable} ready={f.draftReady} queued={f.queued} submitted={f.submitted} total={f.total} />
                      <span className="w-8 shrink-0 text-right tabular-nums text-emerald-600 dark:text-emerald-400" title={t('Tayyor — hali navbatga olinmagan')}>{n(f.sendable)}</span>
                      <span className="w-8 shrink-0 text-right tabular-nums text-amber-600 dark:text-amber-400" title={t('Navbatda — qoralama tayyorlanmoqda')}>{n(f.queued)}</span>
                      <span className="w-8 shrink-0 text-right tabular-nums text-teal-600 dark:text-teal-400" title={t('Qoralama tayyor')}>{n(f.draftReady)}</span>
                      <span className="w-8 shrink-0 text-right tabular-nums text-indigo-600 dark:text-indigo-400" title={t('Sudda')}>{n(f.submitted)}</span>
                    </div>
                    {/* OXIRGI qoralama partiyasi natijasi — Go xatosi (sessiya tugagan, claimant yo'q,
                        firma hujjati...) shu yerda so'zma-so'z ko'rinadi. */}
                    {lb && tone && (
                      <div className="mt-1 flex min-w-0 items-center gap-1.5 pl-7 text-[10px]">
                        <span className={`shrink-0 rounded px-1 py-px font-semibold ${BATCH_CLS[tone]}`}>{t(BATCH_LABEL[tone])}</span>
                        <span className="shrink-0 tabular-nums text-muted">#{lb.jobId} · {hhmm(lb.finishedAt)}</span>
                        {lb.message && (
                          <span className={`min-w-0 truncate ${tone === 'failed' ? 'text-rose-600 dark:text-rose-300' : 'text-muted'}`} title={lb.message}>{lb.message}</span>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
          {/* SUD kesimida */}
          <div>
            <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold text-muted">
              <span>{t('Sud kesimida')}</span>
              <span className="ml-auto flex items-center gap-2 text-[10px] font-normal">
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" />{t('tayyor')}</span>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" />{t('navbatda')}</span>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-teal-500" />{t('qoralama')}</span>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-indigo-500" />{t('sudda')}</span>
              </span>
            </div>
            <ul className="space-y-1">
              {data.courts.length === 0 && <li className="rounded-lg bg-surface-2 px-2 py-1.5 text-[11px] text-muted">{t('Sud biriktirilmagan')}</li>}
              {data.courts.map((c) => (
                <li key={c.courtId} className="flex items-center gap-2 rounded-lg bg-surface-2 px-2 py-1.5 text-[11px]">
                  <span className="min-w-0 flex-1 truncate font-medium" title={c.courtName}>{c.courtName}</span>
                  <Bar sendable={c.sendable} ready={c.draftReady} queued={c.queued} submitted={c.submitted} total={c.total} />
                  <span className="w-8 shrink-0 text-right tabular-nums text-emerald-600 dark:text-emerald-400" title={t('Tayyor — hali navbatga olinmagan')}>{n(c.sendable)}</span>
                  <span className="w-8 shrink-0 text-right tabular-nums text-amber-600 dark:text-amber-400" title={t('Navbatda — qoralama tayyorlanmoqda')}>{n(c.queued)}</span>
                  <span className="w-8 shrink-0 text-right tabular-nums text-teal-600 dark:text-teal-400" title={t('Qoralama tayyor')}>{n(c.draftReady)}</span>
                  <span className="w-8 shrink-0 text-right tabular-nums text-indigo-600 dark:text-indigo-400" title={t('Sudda')}>{n(c.submitted)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
