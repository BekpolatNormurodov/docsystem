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
import { getMibConfig } from './config';
import { pushMibLog } from './log-buffer';
import { firmKeyWords, creditorIsOurs } from './creditor-match';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// SMS OTP kutish chegarasi endi Sozlamalarда (cfg.smsTimeoutSec, default 120s) — deploy'siz o'zgartiriladi.
// SMS kod kelmasa mijoz shuncha marta QAYTA urinilib ko'riladi (keyin ish detalsiz DONE bo'ladi).
const MAX_SMS_ATTEMPTS = 3;
// Bir vaqtда «uchishда» tutiladigan SMS soni (pipeline oynasi). mib.uz bitta sessiyada bir necha
// verifikatsiyani ochiq tutadi (jonli sinov) va formaга ~3 marta kod kiritishga ruxsat beradi.
const SMS_WINDOW = 3;
// Pooldagi bitta kodni bitta ishга sinash cheklovi (3-urinish limitidan oshmaslik uchun).
const MAX_CODE_TRIES = 3;
// Konsolga HAM yozadi, HAM web log-buferiga (/api/mib/logs jonli ko'rsatadi).
const log = (m: string) => { console.log(`[mib] ${m}`); pushMibLog(m); };

// In-process guard: prevents a second GO from spawning a duplicate loop for the SAME report.
const ACTIVE = new Set<number>();
export const isMibRunActive = (reportId: number): boolean => ACTIVE.has(reportId);

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
    await prisma.mibCase.deleteMany({ where: { clientId: c.id } });
    await prisma.mibClient.update({ where: { id: c.id }, data: { status: 'PENDING', error: null, checkedAt: null } });
  }
  if (stuck.length) await prisma.mibReport.update({ where: { id: reportId }, data: { autoRun: false, runJobId: null } }).catch(() => {});
  return stuck.length;
}

async function stillRunning(reportId: number): Promise<boolean> {
  const r = await prisma.mibReport.findUnique({ where: { id: reportId }, select: { autoRun: true } });
  return !!r?.autoRun;
}

// Pipeline'да «uchishдаги» bitta bizники ish.
interface Inflight { clientId: number; pinfl: string; workNumber: string; caseId: number; verifyFormAction: string; markerId: number }

export async function runMibReportJob(jobId: number): Promise<void> {
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { params: true } });
  const reportId = Number((job?.params as any)?.reportId);
  if (!reportId) return;
  if (ACTIVE.has(reportId)) { log(`report ${reportId} already running — skip duplicate`); return; }
  ACTIVE.add(reportId);

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
    await failReport(reportId, jobId, `Captcha (OCR) ishga tushmadi: ${(e as Error).message}`);
    ACTIVE.delete(reportId); return;
  }

  let debtPage = '';
  const bootSession = async () => { const { homeHtml } = await engine.initSession(); debtPage = await engine.getDebtSearchPage(homeHtml); };
  try {
    log(`report ${reportId}: mib.uz sessiya ochilmoqda…`);
    await bootSession();
    log(`report ${reportId}: sessiya tayyor`);
  } catch (e) {
    await failReport(reportId, jobId, `Sessiya ochilmadi: ${(e as Error).message}`);
    await captcha.terminate().catch(() => {}); ACTIVE.delete(reportId); return;
  }

  let processed = 0;
  const bump = async () => { processed += 1; await prisma.job.update({ where: { id: jobId }, data: { progress: processed } }).catch(() => {}); };

  // Pipeline holati
  const inflight: Inflight[] = [];
  const remaining = new Map<number, number>();  // clientId → tugallanmagan bizники ish soni
  const smsBad = new Map<number, boolean>();     // clientId → biror SMS kelmadi
  const cliAttempt = new Map<number, number>();  // clientId → shu urinish raqami
  const cliMeta = new Map<number, { cases: number; ours: number; other: number }>();
  const maxSmsId = async () => (await prisma.mibSms.aggregate({ _max: { id: true } }))._max.id ?? 0;

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
      await prisma.mibClient.update({ where: { id: clientId }, data: { status: 'DONE', checkedAt: new Date() } });
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
        where: { consumed: false, id: { gt: item.markerId }, NOT: { code: '' } },
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
          const firm = resolveCreditor(d.creditor);
          await prisma.mibCase.updateMany({
            where: { id: item.caseId },
            data: {
              personFullName: d.personFullName, creditor: d.creditor, firmName: firm.name, firmInn: firm.inn, isTargetFirm: firm.isTarget,
              executorName: d.executor.name, executorPhone: d.executor.phone, executorDept: d.executor.department,
              courtOrgan: d.court.organ, courtDocType: d.court.docType, courtDocNumber: d.court.docNumber, courtDocDate: d.court.docDate, courtEffectiveDate: d.court.effectiveDate, caseSubject: d.court.subject,
              mibReceivedDate: d.mibDates.receivedDate, mibInitiatedDate: d.mibDates.initiatedDate,
              totalAmount: d.financials.totalAmount, mainDebt: d.financials.mainDebt, executionFee: d.financials.executionFee, fine: d.financials.fine, remainingDebt: d.financials.remainingDebt,
              bankName: d.bankReceipt.bankName, bankMfo: d.bankReceipt.mfo, bankAccount: d.bankReceipt.accountNumber,
              decisions: d.decisions as any, detailFetchedAt: new Date(), error: null,
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
    if (!ok) {
      smsBad.set(item.clientId, true);
      await prisma.mibCase.updateMany({ where: { id: item.caseId }, data: { error: 'SMS kod kelmadi' } }).catch(() => {});
    }
    const rem = (remaining.get(item.clientId) ?? 1) - 1;
    remaining.set(item.clientId, rem);
    if (rem <= 0) await finalizeClient(item.clientId, item.pinfl);
  }

  // Bitta PENDING mijozни qidirib, bizники ishlarига SMS so'raydi (pipeline'ga qo'shadi).
  // false → PENDING mijoz qolmadi.
  async function searchAndQueue(): Promise<boolean> {
    const client = await prisma.mibClient.findFirst({ where: { reportId, status: 'PENDING' }, orderBy: [{ attempts: 'asc' }, { id: 'asc' }] });
    if (!client) return false;
    const attemptNo = (client.attempts ?? 0) + 1;
    log(`report ${reportId}: PINFL ${client.pinfl} tekshirilmoqda…`);
    await prisma.mibClient.update({ where: { id: client.id }, data: { status: 'RUNNING', attempts: { increment: 1 } } });
    try {
      debtPage = await engine.getDebtSearchPage((await engine.request('/home').then((r) => r.text())));
      const search = await engine.searchDebtsByPinfl(client.pinfl, debtPage);

      if (!search.success) {
        log(`PINFL ${client.pinfl}: qidiruv muvaffaqiyatsiz — ${search.message || 'xato'}`);
        await prisma.mibClient.update({ where: { id: client.id }, data: { status: 'FAILED', fio2: search.fio || null, checkedAt: new Date(), error: search.message || 'Qidiruv muvaffaqiyatsiz' } });
        await bump(); return true;
      }
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
        const isOurs = creditorIsOurs(c.creditor, firmWordsList);
        const caseRow = await prisma.mibCase.create({ data: { clientId: client.id, workNumber: c.workNumber, monitoringUrl: c.monitoringUrl ?? null, firmName: c.creditor ?? null } });
        if (!isOurs) { other += 1; await prisma.mibCase.updateMany({ where: { id: caseRow.id }, data: { error: 'Boshqa kreditor — detal olinmadi' } }); continue; }
        ours += 1;
        if (cfg.deepDetail && cfg.phone && c.monitoringUrl) ourItems.push({ workNumber: c.workNumber, monitoringUrl: c.monitoringUrl, caseId: caseRow.id });
        else if (cfg.deepDetail && !cfg.phone) await prisma.mibCase.updateMany({ where: { id: caseRow.id }, data: { error: 'SMS telefon raqami sozlanmagan' } });
      }
      cliMeta.set(client.id, { cases: search.cases.length, ours, other });
      cliAttempt.set(client.id, attemptNo);
      if (ourItems.length === 0) { await finalizeClient(client.id, client.pinfl); return true; }
      remaining.set(client.id, ourItems.length);
      // SMS so'rovlarini KETMA-KET yuboramiz (bitta sessiyada xavfsiz) — kutishlari keyin ustma-ust bo'ladi.
      for (const it of ourItems) {
        const markerId = await maxSmsId();
        const sms = await engine.prepareAndRequestSms(it.monitoringUrl, client.pinfl, it.workNumber, cfg.phone);
        inflight.push({ clientId: client.id, pinfl: client.pinfl, workNumber: it.workNumber, caseId: it.caseId, verifyFormAction: sms.verifyFormAction, markerId });
        log(`PINFL ${client.pinfl} · ish ${it.workNumber}: SMS so'raldi (pipeline)`);
      }
      return true;
    } catch (e) {
      const msg = (e as Error).message || String(e);
      log(`report ${reportId}: PINFL ${client.pinfl} XATO: ${msg}`);
      await prisma.mibClient.update({ where: { id: client.id }, data: { status: 'FAILED', error: msg, checkedAt: new Date() } });
      try { engine = new MibEngine(cfg.baseUrl, { captcha, log }); await bootSession(); } catch { /* keyingi tick */ }
      return true;
    }
  }

  try {
    let noMore = false;
    while (await stillRunning(reportId)) {
      // Oynani to'ldiramiz: SMS_WINDOW ta ish «uchishда» bo'lguncha yangi mijozларни qidiramiz.
      while (inflight.length < SMS_WINDOW && !noMore && (await stillRunning(reportId))) {
        if (!(await searchAndQueue())) { noMore = true; break; }
      }
      if (inflight.length === 0) break; // hech narsa qolmadi
      await drainOldest();
      if (!(await stillRunning(reportId))) break;
      if (cfg.intervalSec > 0) await sleep(Math.min(cfg.intervalSec, 5) * 1000); // yengil oraliq
    }
    // Qolgan «uchishдаги»larni tugatamiz.
    while (inflight.length) await drainOldest();

    const remainingCnt = await prisma.mibClient.count({ where: { reportId, status: 'PENDING' } });
    await prisma.mibReport.update({ where: { id: reportId }, data: { autoRun: false, runJobId: null } });
    await prisma.job.update({ where: { id: jobId }, data: { status: 'DONE', message: remainingCnt ? 'Toʻxtatildi' : 'Yakunlandi' } }).catch(() => {});
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
