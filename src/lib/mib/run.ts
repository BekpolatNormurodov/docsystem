// The MIB automator: a durable runner for one report. Keeps ONE mib.uz session alive across clients
// («session sinmasin»), and persists every client/case to the DB immediately («statelar yo'qolmasin»).
// Resumable: on restart it re-inits the session and continues from the still-PENDING clients. Stops
// gracefully when the report's autoRun flag is cleared (the UI «STOP»).
//
// TEZLIK (pipeline, 2026-09-17): SMS so'rovlari KETMA-KET yuboriladi (bitta sessiyada bir vaqtда bir
// necha SMS-verifikatsiya ochiq tura oladi — jonli tasdiqlangan), lekin OTP-KUTISHlar USTMA-UST bo'ladi:
// SMS_WINDOW ta ish «uchishда» tutiladi. Bitta telefon kifoya — pooldagi kodlar har formaга sinab
// ko'riladi va TO'G'RIsi DETAL (ijrochi nomi) chiqqanidan aniqlanadi (noto'g'ri kod bo'sh detal beradi →
// saqlanmaydi). Bu ~2.5× tezlashtiradi.
import { prisma } from '@/lib/db';
import { MibEngine } from './engine';
import { CaptchaSolver } from './captcha';
import { resolveCreditor } from './companies';
import { getMibConfig, getActiveSims, type ActiveSim } from './config';
import { pushMibLog } from './log-buffer';
import { firmKeyWords, creditorIsOurs } from './creditor-match';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// SMS OTP kutish chegarasi endi Sozlamalarда (cfg.smsTimeoutSec, default 120s) — deploy'siz o'zgartiriladi.
// SMS kod kelmasa mijoz shuncha marta QAYTA urinilib ko'riladi (keyin ish detalsiz DONE bo'ladi).
const MAX_SMS_ATTEMPTS = 3;
// Bir vaqtда «uchishда» tutiladigan SMS soni (pipeline oynasi). mib.uz bitta sessiyada bir necha
// verifikatsiyani ochiq tutadi (jonli sinov) va formaга ~3 marta kod kiritishga ruxsat beradi.
const SMS_WINDOW = 3;
// BIR NECHTA SIM (2026-11-23): Sozlamalarда 2-3 (ko'pi bilan 6) raqam ulansa SMS so'rovlari ular orasida
// taqsimlanadi. Har SIM forwarder'i O'Z webhook manziliга (`?sim=<id>`) yuborsa kod qaysi raqamga kelgani
// aniq — shunda oyna HAR SIMga SMS_WINDOW (jami N×SMS_WINDOW «uchishда») bo'ladi va ish o'z SIMining
// kodlarinigina sinaydi. Biror SIM hali belgisiz (umumiy manzil) bo'lsa kodlar bitta poolда aralashadi —
// MAX_CODE_TRIES'dan oshmaslik uchun jami oyna SMS_WINDOW'da qoladi (raqamlar baribir navbatlashadi).
//
// SIM «sovutish»: bir SIMga so'ralgan SMS ketma-ket shuncha marta kelmasa (SIM o'chgan / balans / forwarder
// uxlagan) — u SIM_COOLDOWN_MS ga chetlatiladi, ishlar qolgan SIMlarga o'tadi. Yagona SIM chetlatilmaydi.
const SIM_MAX_MISSES = 4;
const SIM_COOLDOWN_MS = 10 * 60_000;
// Pooldagi bitta kodni bitta ishга sinash cheklovi (3-urinish limitidan oshmaslik uchun).
const MAX_CODE_TRIES = 3;
// Konsolga HAM yozadi, HAM web log-buferiga (/api/mib/logs jonli ko'rsatadi).
const log = (m: string) => { console.log(`[mib] ${m}`); pushMibLog(m); };

// In-process guard: prevents a second GO from spawning a duplicate loop for the SAME report.
const ACTIVE = new Set<number>();
export const isMibRunActive = (reportId: number): boolean => ACTIVE.has(reportId);

// ULANISH SAQLAGICHI (circuit breaker): mib.uz yiqilsa/bloklasa har mijoz ketma-ket istisno bilan
// FAILED bo'lardi — butun navbat (minglab mijoz) bir necha daqiqada «xato»ga aylanib, run «tugadi»
// deb yopilardi. Endi shuncha mijoz KETMA-KET texnik xato bersa run PAUZA qilinadi: o'sha mijozlar
// PENDINGga qaytadi (yo'qolmaydi), sababi dashboard'да ko'rsatiladi; ulanish tiklangach GO davom ettiradi.
const MAX_CONSEC_ERRORS = 5;
// AQLLI QAYTA ULANISH (2026-11-23): pauza endi «to'xtab qolish» emas — avtomator o'zi kutadi, ulanishni
// tekshiradi va tiklangach DAVOM etadi. Kutish bosqichlari (daqiqa): 1 → 3 → 5 → 10, keyin har 10 daqiqada
// (STOP bosilguncha). Kutish paytida mib.uz'ga so'rov yuborilmaydi (blok bo'lsa uni uzaytirmaslik uchun).
const RECONNECT_STEPS_MIN = [1, 3, 5, 10];
// Oxirgi avtomatik pauza holati (jarayon xotirasida — restartда tozalanadi; log'да ham bor).
//   waiting=true  → avtomator tirik, `retryAt` da ulanishni qayta tekshiradi (attempt — nechanchi urinish)
//   waiting=false → butunlay to'xtagan (masalan OCR ishga tushmadi) — qo'lda GO kerak
export interface MibHalt { at: number; reason: string; waiting: boolean; retryAt?: number; attempt?: number }
const LAST_HALT = new Map<number, MibHalt>();
export const getMibHalt = (reportId: number): MibHalt | null => LAST_HALT.get(reportId) ?? null;

/**
 * «Xato» (FAILED) bo'lib qolgan mijozlarni qayta navbatga (PENDING) qaytaradi — «Xatolarni davom
 * ettirish». Urinishlar soni nolga tushadi (SMS qayta urinish limiti yangidan). Qaytaradi: nechta.
 */
export async function requeueFailedClients(reportId: number): Promise<number> {
  const r = await prisma.mibClient.updateMany({ where: { reportId, status: 'FAILED' }, data: { status: 'PENDING', error: null, attempts: 0, checkedAt: null } });
  return r.count;
}

// Qo'lda qo'shilgan (bitta PINFL) mijozlar shu «holat» bilan belgilanadi — Excel qayta qurishda
// (build) o'chirilmaydi, shuning uchun tekshiruvlar yig'ilib boradi.
export const MANUAL_HOLAT = 'Qoʻlda';

/**
 * Reportning avtomatorini ishga tushiradi (agar hali ishlamayotgan bo'lsa). Faqat PENDING mijozlarni
 * ishlaydi. Qaytaradi: {jobId, pending} — yangi loop boshlansa; null — allaqachon ishlayapti/PENDING yo'q.
 */
export async function startMibRun(reportId: number): Promise<{ jobId: number; pending: number } | null> {
  if (ACTIVE.has(reportId)) return null;
  await prisma.mibClient.updateMany({ where: { reportId, status: 'RUNNING' }, data: { status: 'PENDING' } });
  const pending = await prisma.mibClient.count({ where: { reportId, status: 'PENDING' } });
  if (pending === 0) return null;
  const job = await prisma.job.create({ data: { type: 'MIB_RUN', status: 'PENDING', total: pending, params: { reportId } } });
  await prisma.mibReport.update({ where: { id: reportId }, data: { autoRun: true, runJobId: job.id } });
  void runMibReportJob(job.id).catch(async () => {
    await prisma.mibReport.update({ where: { id: reportId }, data: { autoRun: false, runJobId: null } }).catch(() => {});
  });
  return { jobId: job.id, pending };
}

/**
 * «Zombi» RUNNING mijozlarni tuzatadi: jarayon restart bo'lsa (deploy) yoki run uzilsa, mijoz RUNNING
 * holatida qotib qolishi mumkin. Jonli run YO'Q bo'lsa — eski (yarim) ishlarni O'CHIRIB PENDINGga
 * qaytaradi (GO bosilganда toza qaytadan tekshiriladi). Dashboard/detal GET'ida chaqiriladi.
 */
export async function reconcileZombieClients(reportId: number): Promise<number> {
  if (ACTIVE.has(reportId)) return 0;
  const stuck = await prisma.mibClient.findMany({ where: { reportId, status: 'RUNNING' }, select: { id: true } });
  for (const c of stuck) {
    // Zombi RUNNING'даgi FAOL ishlarni arxivlash (yarim to'lgan bo'lishi mumkin — qayta olamiz), lekin
    // eski to'la nusxa DB'да saqlanadi.
    await prisma.mibCase.updateMany({ where: { clientId: c.id, archivedAt: null }, data: { archivedAt: new Date() } });
    await prisma.mibClient.update({ where: { id: c.id }, data: { status: 'PENDING', error: null, checkedAt: null } });
  }
  // autoRun'ga TEGMAYMIZ: jarayon (deploy/restart) o'lgan bo'lsa ham foydalanuvchi run'ni to'xtatmagan —
  // resume-on-view (GET /api/mib/[id]) uni o'zi davom ettirsin. Ilgari bu yerda autoRun=false qilinardi
  // va har web deploy'dan keyin run «pauza» bo'lib qolardi (2026-09-30).
  return stuck.length;
}

async function stillRunning(reportId: number): Promise<boolean> {
  const r = await prisma.mibReport.findUnique({ where: { id: reportId }, select: { autoRun: true } });
  return !!r?.autoRun;
}

// Pipeline'да «uchishдаги» bitta bizники ish.
interface Inflight { clientId: number; pinfl: string; workNumber: string; caseId: number; verifyFormAction: string; markerId: number; simId: string }

export async function runMibReportJob(jobId: number): Promise<void> {
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { params: true } });
  const reportId = Number((job?.params as any)?.reportId);
  if (!reportId) return;
  if (ACTIVE.has(reportId)) { log(`report ${reportId} already running — skip duplicate`); return; }
  ACTIVE.add(reportId);
  LAST_HALT.delete(reportId);

  await prisma.job.update({ where: { id: jobId }, data: { status: 'RUNNING' } }).catch(() => {});
  await prisma.mibClient.updateMany({ where: { reportId, status: 'RUNNING' }, data: { status: 'PENDING' } });

  const cfg = await getMibConfig();
  const smsTimeoutMs = (cfg.smsTimeoutSec || 120) * 1000; // Sozlamalardan — deploy'siz o'zgartiriladi
  const firms = await prisma.firm.findMany({ select: { shortName: true } });
  const firmWordsList = firms.map((f) => firmKeyWords(f.shortName)).filter((w) => w.length);
  const captcha = new CaptchaSolver();
  let engine = new MibEngine(cfg.baseUrl, { captcha, log });

  try {
    log(`report ${reportId}: OCR (tesseract) ishga tushmoqda…`);
    await captcha.init();
    log(`report ${reportId}: OCR tayyor`);
  } catch (e) {
    const reason = `Captcha (OCR) ishga tushmadi: ${(e as Error).message}`;
    log(`report ${reportId}: ${reason}`);
    LAST_HALT.set(reportId, { at: Date.now(), reason, waiting: false });
    await failReport(reportId, jobId, reason);
    ACTIVE.delete(reportId); return;
  }

  let debtPage = '';
  const bootSession = async () => {
    const { homeHtml } = await engine.initSession();
    debtPage = await engine.getDebtSearchPage(homeHtml);
    // Blok/texnik-ishlar sahifasi ham 200 qaytaradi — qidiruv formasi borligini tekshiramiz.
    if (!/id="tab_pinfl"|Wicket\.Ajax/i.test(debtPage)) throw new Error('mib.uz PINFL qidiruv formasini qaytarmadi (blok yoki texnik ishlar)');
  };

  // Ulanish yo'q: 1 → 3 → 5 → 10 daqiqa (keyin har 10) kutib, yangi sessiya ochib ko'radi. Ochilsa true
  // (run davom etadi). STOP bosilsa false. Kutish 5 soniyalik bo'laklarda — STOP darhol seziladi.
  async function waitForConnection(why: string): Promise<boolean> {
    const since = Date.now();
    for (let attempt = 0; ; attempt++) {
      const mins = RECONNECT_STEPS_MIN[Math.min(attempt, RECONNECT_STEPS_MIN.length - 1)]!;
      const retryAt = Date.now() + mins * 60_000;
      LAST_HALT.set(reportId, { at: since, reason: why, waiting: true, retryAt, attempt: attempt + 1 });
      log(`report ${reportId}: ${why} — ${mins} daqiqa kutiladi, soʻng ulanish qayta tekshiriladi (${attempt + 1}-urinish)`);
      while (Date.now() < retryAt) {
        if (!(await stillRunning(reportId))) return false;
        await sleep(Math.min(5000, Math.max(0, retryAt - Date.now())));
      }
      if (!(await stillRunning(reportId))) return false;
      try {
        engine = new MibEngine(cfg.baseUrl, { captcha, log });
        await bootSession();
        LAST_HALT.delete(reportId);
        log(`report ${reportId}: ulanish tiklandi (${Math.round((Date.now() - since) / 60_000)} daqiqadan soʻng) — davom etilmoqda`);
        return true;
      } catch (e) {
        why = `mib.uz hali javob bermayapti: ${(e as Error).message || String(e)}`;
      }
    }
  }

  try {
    log(`report ${reportId}: mib.uz sessiya ochilmoqda…`);
    await bootSession();
    log(`report ${reportId}: sessiya tayyor`);
  } catch (e) {
    // Boshida ham ulanish bo'lmasa run yopilmaydi — kutib qayta urinadi (STOP bosilsa chiqadi).
    const ok = await waitForConnection(`mib.uz sessiyasi ochilmadi: ${(e as Error).message}`);
    if (!ok) {
      LAST_HALT.delete(reportId);
      await prisma.mibReport.update({ where: { id: reportId }, data: { autoRun: false, runJobId: null } }).catch(() => {});
      await prisma.job.update({ where: { id: jobId }, data: { status: 'DONE', message: 'Toʻxtatildi' } }).catch(() => {});
      await captcha.terminate().catch(() => {}); ACTIVE.delete(reportId); return;
    }
  }

  let processed = 0;
  // Ketma-ket texnik xato (istisno) bergan mijozlar — saqlagich uchun. Har muvaffaqiyatli qidiruv tozalaydi.
  let consecErrIds: number[] = [];
  const bump = async () => { processed += 1; await prisma.job.update({ where: { id: jobId }, data: { progress: processed } }).catch(() => {}); };

  // Pipeline holati
  const inflight: Inflight[] = [];
  const remaining = new Map<number, number>();  // clientId → tugallanmagan bizники ish soni
  const smsBad = new Map<number, boolean>();     // clientId → biror SMS kelmadi
  const cliAttempt = new Map<number, number>();  // clientId → shu urinish raqami
  const cliMeta = new Map<number, { cases: number; ours: number; other: number }>();
  const maxSmsId = async () => (await prisma.mibSms.aggregate({ _max: { id: true } }))._max.id ?? 0;

  // ── SIMlar ────────────────────────────────────────────────────────────────
  let sims: ActiveSim[] = await getActiveSims().catch(() => []);
  const simMiss = new Map<string, number>();   // simId → ketma-ket kelmagan SMS soni
  const simBench = new Map<string, number>();  // simId → shu vaqtgacha chetlatilgan (ms)
  let simRr = 0;
  const simSig = (l: ActiveSim[]) => l.map((x) => `${x.id}:${x.phone}:${x.tagged ? 1 : 0}`).join(',');
  const simName = (x: { label: string; phone: string }) => `${x.label} (…${x.phone.slice(-4)})`;
  const usableSims = () => { const now = Date.now(); const u = sims.filter((x) => (simBench.get(x.id) ?? 0) <= now); return u.length ? u : sims; };
  // Kodlar SIM bo'yicha ajratiladimi (hamma ishlatilayotgan SIM o'z manzilidan SMS olganmi).
  const perSimMode = () => { const u = usableSims(); return u.length > 1 && u.every((x) => x.tagged); };
  const windowCap = () => (perSimMode() ? SMS_WINDOW * usableSims().length : SMS_WINDOW);
  const simLoad = (id: string) => inflight.reduce((n, it) => n + (it.simId === id ? 1 : 0), 0);
  // Keyingi SMS qaysi SIMga so'raladi: eng kam yuklangani (teng bo'lsa navbat bilan). null → hammasi band.
  function pickSim(): ActiveSim | null {
    const u = usableSims();
    if (u.length === 0) return null;
    const per = perSimMode();
    let best: ActiveSim | null = null, bestLoad = Infinity;
    for (let i = 0; i < u.length; i++) {
      const cand = u[(simRr + i) % u.length]!;
      const load = simLoad(cand.id);
      if (per && load >= SMS_WINDOW) continue;
      if (load < bestLoad) { best = cand; bestLoad = load; }
    }
    if (best) simRr = (u.indexOf(best) + 1) % u.length;
    return best;
  }
  if (sims.length > 1) log(`report ${reportId}: ${sims.length} ta SIM — ${sims.map(simName).join(', ')} · ${perSimMode() ? `har SIMga ${SMS_WINDOW} tadan (jami ${windowCap()}) parallel SMS` : `kodlar umumiy poolда (baʼzi SIM oʻz webhook manzilisiz) — jami ${SMS_WINDOW} parallel SMS`}`);

  async function finalizeClient(clientId: number, pinfl: string): Promise<void> {
    const bad = smsBad.get(clientId);
    const attemptNo = cliAttempt.get(clientId) ?? 1;
    const m = cliMeta.get(clientId) ?? { cases: 0, ours: 0, other: 0 };
    if (bad && attemptNo < MAX_SMS_ATTEMPTS) {
      // Biror SMS kelmadi — mijozni QAYTA NAVBATGA (PENDING). Ishlar o'chiriladi (qayta urinishда
      // dublikat bo'lmasin). «attempts asc» tartibi tufayli qolganlari tugagach qayta olinadi.
      await prisma.mibCase.deleteMany({ where: { clientId } });
      await prisma.mibClient.update({ where: { id: clientId }, data: { status: 'PENDING', error: `SMS kelmadi — qayta urinadi (${attemptNo}/${MAX_SMS_ATTEMPTS})` } });
      log(`report ${reportId}: PINFL ${pinfl} → SMS kelmadi, qayta navbatga (${attemptNo}/${MAX_SMS_ATTEMPTS})`);
    } else {
      // Oldingi urinishdagi «qayta urinadi (n/3)» xatosi qolib ketmasin — sahifa «to'xtab qolgan» ko'rinardi.
      await prisma.mibClient.update({ where: { id: clientId }, data: { status: 'DONE', checkedAt: new Date(), error: bad ? 'Baʼzi SMS kelmadi — detal toʻliq emas' : null } });
      log(`report ${reportId}: PINFL ${pinfl} → ${m.cases} ijro (${m.ours} bizniki, ${m.other} boshqa)${bad ? ` — ba'zi SMS kelmadi` : ''}`);
    }
    remaining.delete(clientId); smsBad.delete(clientId); cliAttempt.delete(clientId); cliMeta.delete(clientId);
    await bump();
  }

  // Bitta bizники ishни tugallash: pool'dан (markerId'дан keyingi) kodlarni formaga sinaydi, TO'G'Rи
  // kodni DETAL orqali aniqlaydi (ijrochi nomi bo'lsa — to'g'ri; bo'sh bo'lsa — noto'g'ri, consume qilinmaydi).
  async function completeCase(item: Inflight): Promise<boolean> {
    const deadline = Date.now() + smsTimeoutMs;
    const tried = new Set<string>();
    let tries = 0;
    while (Date.now() < deadline && tries < MAX_CODE_TRIES) {
      const rows = await prisma.mibSms.findMany({
        // Faqat SHU ish so'ralgan SIMga kelgan kodlar (+ belgisiz — eski umumiy manzildan kelganlar).
        where: { consumed: false, id: { gt: item.markerId }, NOT: { code: '' }, OR: [{ sim: item.simId }, { sim: null }] },
        orderBy: { id: 'asc' }, take: SMS_WINDOW + 3,
      });
      const fresh = rows.filter((r) => !tried.has(r.code));
      if (fresh.length === 0) { await sleep(3000); continue; }
      for (const row of fresh) {
        if (tries >= MAX_CODE_TRIES) break;
        tried.add(row.code); tries += 1;
        try {
          const step19Url = await engine.submitSmsCode(item.verifyFormAction, row.code);
          const d = await engine.fetchExecutionDetails(step19Url);
          const valid = !!(d && d.executor && d.executor.name && d.executor.name !== 'Nomaʼlum');
          if (!valid) continue; // bo'sh detal → noto'g'ri kod (boshqa ishники); consume QILMAYMIZ
          await prisma.mibSms.update({ where: { id: row.id }, data: { consumed: true } }).catch(() => {});
          // Klassifikatsiya (firma/isTargetFirm) allaqachon Step10 MASKASIДАN (creation'да) aniqlangan.
          // Banner buzган Step19 uni DOWNGRADE qilmaydi (ours ish Davlat bo'lib qolmasin). Step19 faqat
          // UPGRADE qiladi — Step10 bo'sh/noaniq bo'lса, detalда real target kreditor topilса.
          const f19 = resolveCreditor(d.creditor);
          const upgrade = f19.isTarget ? { firmName: f19.name, firmInn: f19.inn, isTargetFirm: true, creditor: d.creditor } : {};
          await prisma.mibCase.updateMany({
            where: { id: item.caseId },
            data: {
              personFullName: d.personFullName,
              executorName: d.executor.name, executorPhone: d.executor.phone, executorDept: d.executor.department,
              courtOrgan: d.court.organ, courtDocType: d.court.docType, courtDocNumber: d.court.docNumber, courtDocDate: d.court.docDate, courtEffectiveDate: d.court.effectiveDate, caseSubject: d.court.subject,
              mibReceivedDate: d.mibDates.receivedDate, mibInitiatedDate: d.mibDates.initiatedDate,
              totalAmount: d.financials.totalAmount, mainDebt: d.financials.mainDebt, executionFee: d.financials.executionFee, fine: d.financials.fine, remainingDebt: d.financials.remainingDebt,
              bankName: d.bankReceipt.bankName, bankMfo: d.bankReceipt.mfo, bankAccount: d.bankReceipt.accountNumber,
              decisions: d.decisions as any, detailFetchedAt: new Date(), error: null,
              ...upgrade,
            },
          });
          return true;
        } catch { /* submit yiqildi → keyingi kod */ }
      }
    }
    return false;
  }

  // Eng eski «uchishдаги» ishni tugatadi.
  async function drainOldest(): Promise<void> {
    const item = inflight.shift();
    if (!item) return;
    log(`PINFL ${item.pinfl} · ish ${item.workNumber}: OTP kutilib, detal olinmoqda…`);
    let ok = false;
    try { ok = await completeCase(item); } catch { ok = false; }
    if (ok) simMiss.set(item.simId, 0);
    else {
      smsBad.set(item.clientId, true);
      await prisma.mibCase.updateMany({ where: { id: item.caseId }, data: { error: 'SMS kod kelmadi' } }).catch(() => {});
      // SIM ketma-ket javobsiz — boshqa SIM bor bo'lsa buni vaqtincha chetlatamiz (ishlar ularga o'tadi).
      const miss = (simMiss.get(item.simId) ?? 0) + 1;
      simMiss.set(item.simId, miss);
      const sim = sims.find((x) => x.id === item.simId);
      if (sim && miss >= SIM_MAX_MISSES && usableSims().some((x) => x.id !== sim.id) && (simBench.get(sim.id) ?? 0) <= Date.now()) {
        simBench.set(sim.id, Date.now() + SIM_COOLDOWN_MS); simMiss.set(sim.id, 0);
        log(`report ${reportId}: ${simName(sim)} ga ${miss} ta SMS ketma-ket kelmadi — ${SIM_COOLDOWN_MS / 60_000} daqiqaga chetlatildi, ishlar qolgan SIMlarga oʻtadi`);
      }
    }
    const rem = (remaining.get(item.clientId) ?? 1) - 1;
    remaining.set(item.clientId, rem);
    if (rem <= 0) await finalizeClient(item.clientId, item.pinfl);
  }

  // Saqlagich: mijoz texnik xato berdi. MAX_CONSEC_ERRORS ta ketma-ket bo'lsa — o'sha mijozlarni PENDINGga
  // qaytaradi (navbat «xato»ga yonib ketmaydi) va ulanish tiklanguncha KUTADI (1/3/5/10 daqiqa), so'ng run
  // o'zi davom etadi. true → saqlagich ishladi (chaqiruvchi shu mijozni qayta sanamaydi).
  async function tripBreaker(clientId: number, msg: string): Promise<boolean> {
    consecErrIds.push(clientId);
    if (consecErrIds.length < MAX_CONSEC_ERRORS) return false;
    // «Uchishdagi» ishlar eski sessiyaga bog'liq — kutishdan oldin tugatib olamiz (aks holda SMS'i yo'qoladi).
    while (inflight.length) await drainOldest();
    const n = consecErrIds.length;
    await prisma.mibClient.updateMany({ where: { id: { in: consecErrIds }, status: 'FAILED' }, data: { status: 'PENDING', error: null, checkedAt: null } });
    consecErrIds = [];
    await waitForConnection(`mib.uz bilan ulanish uzildi — ${n} ta mijoz ketma-ket xato berdi (${msg}). Mijozlar navbatda qoldi`);
    return true; // STOP bosilgan bo'lsa asosiy sikl `stillRunning` orqali o'zi chiqadi
  }

  // Bitta PENDING mijozни qidirib, bizники ishlarига SMS so'raydi (pipeline'ga qo'shadi).
  // false → PENDING mijoz qolmadi.
  async function searchAndQueue(): Promise<boolean> {
    const client = await prisma.mibClient.findFirst({ where: { reportId, status: 'PENDING' }, orderBy: [{ attempts: 'asc' }, { id: 'asc' }] });
    if (!client) return false;
    // Telefon raqami run davomida o'zgarishi mumkin (Sozlamalar). Har mijoz oldidan qayta o'qiymiz —
    // aks holda run ESKI raqamga SMS so'rab, hamma ish «SMS kelmadi» bo'lib qolardi (2026-09-30).
    const fresh = await getMibConfig().catch(() => null);
    if (fresh) cfg.deepDetail = fresh.deepDetail;
    // SIMlar ro'yxati ham (qo'shildi / o'chirildi / birinchi belgili SMS keldi → oyna kengayadi).
    const freshSims = await getActiveSims().catch(() => null);
    if (freshSims && simSig(freshSims) !== simSig(sims)) {
      sims = freshSims;
      log(`report ${reportId}: SIMlar yangilandi — ${sims.length ? sims.map(simName).join(', ') : 'ishlayotgan SIM yoʻq'} · jami ${windowCap()} parallel SMS`);
    }
    const attemptNo = (client.attempts ?? 0) + 1;
    log(`report ${reportId}: PINFL ${client.pinfl} tekshirilmoqda…`);
    await prisma.mibClient.update({ where: { id: client.id }, data: { status: 'RUNNING', attempts: { increment: 1 } } });
    try {
      debtPage = await engine.getDebtSearchPage((await engine.request('/home').then((r) => r.text())));
      const search = await engine.searchDebtsByPinfl(client.pinfl, debtPage);

      if (!search.success) {
        log(`PINFL ${client.pinfl}: qidiruv muvaffaqiyatsiz — ${search.message || 'xato'}`);
        await prisma.mibClient.update({ where: { id: client.id }, data: { status: 'FAILED', fio2: search.fio || null, checkedAt: new Date(), error: search.message || 'Qidiruv muvaffaqiyatsiz' } });
        // Captcha ketma-ket yechilmasa ham bu tizimli nosozlik (sahifa buzilgan / blok) — saqlagichga sanaladi.
        if (await tripBreaker(client.id, search.message || 'Qidiruv muvaffaqiyatsiz')) return true;
        await bump(); return true;
      }
      consecErrIds = []; // mib.uz to'g'ri javob berdi — ulanish joyida
      if (!search.cases || search.cases.length === 0) {
        log(`PINFL ${client.pinfl}: qarz topilmadi (toza)`);
        await prisma.mibClient.update({ where: { id: client.id }, data: { status: 'CLEAN', fio2: search.fio || null, totalDebt: search.totalDebt || null, currentDebt: search.currentDebt || null, checkedAt: new Date(), error: null } });
        await bump(); return true;
      }
      await prisma.mibClient.update({ where: { id: client.id }, data: { fio2: search.fio || null, totalDebt: search.totalDebt || null, currentDebt: search.currentDebt || null } });
      await prisma.mibCase.deleteMany({ where: { clientId: client.id } });
      let ours = 0, other = 0;
      const ourItems: { workNumber: string; monitoringUrl: string; caseId: number }[] = [];
      for (const c of search.cases) {
        // Kreditor null/bo'sh bo'lsa (Step10 parse aniqlay olmadi — masalan «Ундирувчи» sanog'i ish
        // sonига mos kelmay hammasi null bo'lib qolган) — EHTIYOT uchun BIZNIKI deb chuqur tortamiz.
        // Aks holda parse xatosi tufayli bizning firma ishi jimgina «boshqa» bo'lib tushib qolardi
        // (2026-09-17 audit). resolveCreditor Step19 detalида aniq hal qiladi (isTargetFirm).
        const credStr = (c.creditor ?? '').trim();
        // KLASSIFIKATSIYA — ISHONCHLI Step10 (qidiruv natijasi) MASKASIDAN, resolveCreditor (mask-aware).
        // Step19 detali ba'zан banner/slogan bilan buzilib, kreditor bo'sh bo'lardi → ours ish «Davlat»
        // bo'lib qolardi (2026-09-17: BRIGHT ishi Davlat bo'lib ketgan). Endi Step19 FAQAT ijrochi/summa
        // detali uchun; firma/isTargetFirm bu yerda, maskadan aniqlanadi va Step19'да O'ZGARMAYDI.
        const f0 = resolveCreditor(credStr);
        // Chuqur tortish qarori — kengroq (recall): resolveCreditor target desa YOKI creditorIsOurs desa,
        // YOKI mask bo'sh (fail-safe). Klassifikatsiya baribir maskadan aniq bo'ladi.
        const isOurs = credStr === '' ? true : (f0.isTarget || creditorIsOurs(credStr, firmWordsList));
        const caseRow = await prisma.mibCase.create({ data: { clientId: client.id, workNumber: c.workNumber, monitoringUrl: c.monitoringUrl ?? null, creditor: c.creditor ?? null, firmName: f0.name, firmInn: f0.inn, isTargetFirm: f0.isTarget } });
        if (!isOurs) { other += 1; await prisma.mibCase.updateMany({ where: { id: caseRow.id }, data: { error: 'Boshqa kreditor — detal olinmadi' } }); continue; }
        ours += 1;
        if (cfg.deepDetail && sims.length && c.monitoringUrl) ourItems.push({ workNumber: c.workNumber, monitoringUrl: c.monitoringUrl, caseId: caseRow.id });
        else if (cfg.deepDetail && !sims.length) await prisma.mibCase.updateMany({ where: { id: caseRow.id }, data: { error: 'SMS telefon raqami sozlanmagan' } });
      }
      cliMeta.set(client.id, { cases: search.cases.length, ours, other });
      cliAttempt.set(client.id, attemptNo);
      if (ourItems.length === 0) { await finalizeClient(client.id, client.pinfl); return true; }
      remaining.set(client.id, ourItems.length);
      // SMS so'rovlarini KETMA-KET yuboramiz (bitta sessiyada xavfsiz) — kutishlari keyin ustma-ust bo'ladi.
      // OVERFILL'ni oldini olamiz: bitta mijozда ko'p (>SMS_WINDOW) bizniki ish bo'lsa, hammasini birdan
      // «uchishга» qo'ymaymiz — aks holda completeCase pooldа SMS_WINDOW'дан ko'p kod bo'lib, MAX_CODE_TRIES=3
      // ichida to'g'ri kod sinalmay qolishi mumkin edi (2026-09-17 audit). Oyna to'lsa — eng eskisini tugatamiz.
      for (const it of ourItems) {
        while (inflight.length >= windowCap()) await drainOldest();
        // Bo'sh SIM: eng kam yuklangani. Hammasi band bo'lsa — eng eski ishni tugatib joy ochamiz.
        let sim = pickSim();
        while (!sim && inflight.length) { await drainOldest(); sim = pickSim(); }
        sim ??= usableSims()[0] ?? sims[0]!;
        const markerId = await maxSmsId();
        const sms = await engine.prepareAndRequestSms(it.monitoringUrl, client.pinfl, it.workNumber, sim.phone);
        inflight.push({ clientId: client.id, pinfl: client.pinfl, workNumber: it.workNumber, caseId: it.caseId, verifyFormAction: sms.verifyFormAction, markerId, simId: sim.id });
        log(`PINFL ${client.pinfl} · ish ${it.workNumber}: SMS so'raldi${sims.length > 1 ? ` → ${simName(sim)}` : ''} (pipeline)`);
      }
      return true;
    } catch (e) {
      const msg = (e as Error).message || String(e);
      log(`report ${reportId}: PINFL ${client.pinfl} XATO: ${msg}`);
      await prisma.mibClient.update({ where: { id: client.id }, data: { status: 'FAILED', error: msg, checkedAt: new Date() } });
      // Sessiyani ALMASHTIRISHDAN OLDIN «uchishдаги» ishларни tugatamiz: ularning verify-formasi ESKI
      // sessiya (JSESSIONID)ga bog'liq — yangi sessiya cookie bilan yuborilsa mib.uz uni tanimaydi va
      // SMS'i kelgan bo'lsa ham «kelmadi» bo'lib buziladi (2026-09-17 audit). Eski sessiyada tugatib olamiz.
      while (inflight.length) await drainOldest();
      if (await tripBreaker(client.id, msg)) return true;
      try { engine = new MibEngine(cfg.baseUrl, { captcha, log }); await bootSession(); } catch { /* keyingi tick */ }
      return true;
    }
  }

  try {
    let noMore = false;
    while (await stillRunning(reportId)) {
      // Oynani to'ldiramiz: SMS_WINDOW ta ish «uchishда» bo'lguncha yangi mijozларни qidiramiz.
      while (inflight.length < windowCap() && !noMore && (await stillRunning(reportId))) {
        if (!(await searchAndQueue())) { noMore = true; break; }
      }
      if (inflight.length === 0) {
        // SMS kelmagan mijoz finalizeClient'da qayta PENDING bo'ladi — bu `noMore`dan KEYIN sodir bo'lishi
        // mumkin. Tekshirmasak run oxiridagi qayta urinishlar hech qachon bajarilmay «Toʻxtatildi» bo'lardi
        // (2026-09-28: BEKTOSHEV 1/3 da qolib ketdi). Urinishlar MAX_SMS_ATTEMPTS bilan cheklangan — cheksiz emas.
        if (noMore && (await prisma.mibClient.count({ where: { reportId, status: 'PENDING' } })) > 0) { noMore = false; continue; }
        break; // hech narsa qolmadi
      }
      await drainOldest();
      if (!(await stillRunning(reportId))) break;
      if (cfg.intervalSec > 0) await sleep(Math.min(cfg.intervalSec, 5) * 1000); // yengil oraliq
    }
    // Qolgan «uchishдаги»larni tugatamiz.
    while (inflight.length) await drainOldest();

    const remainingCnt = await prisma.mibClient.count({ where: { reportId, status: 'PENDING' } });
    await prisma.mibReport.update({ where: { id: reportId }, data: { autoRun: false, runJobId: null } });
    await prisma.job.update({ where: { id: jobId }, data: { status: 'DONE', message: remainingCnt ? 'Toʻxtatildi' : 'Yakunlandi' } }).catch(() => {});
    LAST_HALT.delete(reportId); // kutish paytida STOP bosilgan bo'lsa «kutilmoqda» belgisi qolib ketmasin
    log(`report ${reportId}: tugadi (${processed} ta ishlandi, ${remainingCnt} qoldi)`);
  } finally {
    await captcha.terminate().catch(() => {});
    ACTIVE.delete(reportId);
  }
}

async function failReport(reportId: number, jobId: number, message: string): Promise<void> {
  await prisma.mibReport.update({ where: { id: reportId }, data: { autoRun: false, runJobId: null } }).catch(() => {});
  await prisma.job.update({ where: { id: jobId }, data: { status: 'FAILED', message } }).catch(() => {});
}
