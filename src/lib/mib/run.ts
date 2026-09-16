// The MIB automator: a durable, sequential runner for one report. Keeps ONE mib.uz session alive
// across clients («session sinmasin»), processes them one-by-one pacing by intervalSec («1 minutdan
// ketsin»), and persists every client/case to the DB immediately («statelar yo'qolmasin»). Resumable:
// on restart it re-inits the session and continues from the still-PENDING clients. Stops gracefully
// when the report's autoRun flag is cleared (the UI «STOP»).
import { prisma } from '@/lib/db';
import { MibEngine } from './engine';
import { CaptchaSolver } from './captcha';
import { resolveCreditor } from './companies';
import { getMibConfig } from './config';
import { pushMibLog } from './log-buffer';
import { firmKeyWords, creditorIsOurs } from './creditor-match';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SMS_TIMEOUT_MS = 120_000;
// SMS kod kelmasa mijoz shuncha marta QAYTA urinilib ko'riladi (keyin ish detalsiz DONE bo'ladi).
// Qayta urinish qolgan mijozlar ishlab bo'lingandan KEYIN bo'ladi (tanlash «attempts asc»).
const MAX_SMS_ATTEMPTS = 3;
// Konsolga HAM yozadi, HAM web log-buferiga (/api/mib/logs jonli ko'rsatadi).
const log = (m: string) => { console.log(`[mib] ${m}`); pushMibLog(m); };

// In-process guard: prevents a second GO from spawning a duplicate loop for the SAME report (which is
// how two clients ended up RUNNING at once). Survives only within one web process — a restart clears it,
// so pressing GO after a restart correctly resumes.
const ACTIVE = new Set<number>();
export const isMibRunActive = (reportId: number): boolean => ACTIVE.has(reportId);

// Qo'lda qo'shilgan (bitta PINFL) mijozlar shu «holat» bilan belgilanadi — Excel qayta qurishda
// (build) o'chirilmaydi, shuning uchun tekshiruvlar yig'ilib boradi.
export const MANUAL_HOLAT = 'Qoʻlda';

/**
 * Reportning avtomatorini ishga tushiradi (agar hali ishlamayotgan bo'lsa) — GO va «bitta PINFL
 * qo'shish» ham shuni chaqiradi. Faqat PENDING mijozlarni ishlaydi, shuning uchun jonli loop
 * ketayotganda yangi qo'shilgan PINFL keyingi aylanishda o'zi olinadi (bu yerda null qaytadi).
 * Qaytaradi: {jobId, pending} — yangi loop boshlansa; null — allaqachon ishlayapti yoki PENDING yo'q.
 */
export async function startMibRun(reportId: number): Promise<{ jobId: number; pending: number } | null> {
  if (ACTIVE.has(reportId)) return null; // jonli loop bor — yangi PENDING'ni o'zi oladi
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
 * «Zombi» RUNNING mijozlarni tuzatadi: jarayon restart bo'lsa (deploy) yoki run uzilsa, mijoz
 * RUNNING holatida qotib qolishi mumkin. Jonli run YO'Q bo'lsa — natijaga qarab tiklaymiz
 * (ishlari bor → DONE, aks holda → PENDING). Dashboard/detal GET'ida chaqiriladi (o'zini davolaydi).
 */
export async function reconcileZombieClients(reportId: number): Promise<number> {
  if (ACTIVE.has(reportId)) return 0; // jonli run bor — tegmaymiz
  const stuck = await prisma.mibClient.findMany({ where: { reportId, status: 'RUNNING' }, select: { id: true } });
  // MUHIM: DONE qilmaymiz — mijoz yarim ishlangan bo'lishi mumkin (ishlar birma-bir, har biriga SMS
  // kutiladi). Uzilgan bo'lsa eski (yarim) ishlarni O'CHIRIB, PENDINGga qaytaramiz — GO bosilganda
  // toza qaytadan to'liq tekshiriladi (dublikat ham, kam ish ham chiqmaydi).
  for (const c of stuck) {
    await prisma.mibCase.deleteMany({ where: { clientId: c.id } });
    await prisma.mibClient.update({ where: { id: c.id }, data: { status: 'PENDING', error: null, checkedAt: null } });
  }
  // Jonli run yo'q — «ishlayapti» (autoRun) yolg'on bo'lib qolmasin.
  if (stuck.length) await prisma.mibReport.update({ where: { id: reportId }, data: { autoRun: false, runJobId: null } }).catch(() => {});
  return stuck.length;
}

/** Poll the MibSms table for an OTP that arrived AFTER `sinceMs`, marking it consumed. */
async function waitForSms(sinceMs: number, timeoutMs = SMS_TIMEOUT_MS): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await prisma.mibSms.findFirst({
      // Faqat KODLI qator (kodsiz test xabar yozuvlarini olmaymiz).
      where: { consumed: false, createdAt: { gte: new Date(sinceMs) }, NOT: { code: '' } },
      orderBy: { id: 'desc' },
    });
    if (row) {
      await prisma.mibSms.update({ where: { id: row.id }, data: { consumed: true } });
      return row.code;
    }
    await sleep(2000);
  }
  return null;
}

async function stillRunning(reportId: number): Promise<boolean> {
  const r = await prisma.mibReport.findUnique({ where: { id: reportId }, select: { autoRun: true } });
  return !!r?.autoRun;
}

export async function runMibReportJob(jobId: number): Promise<void> {
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { params: true } });
  const reportId = Number((job?.params as any)?.reportId);
  if (!reportId) return;
  if (ACTIVE.has(reportId)) { log(`report ${reportId} already running — skip duplicate`); return; }
  ACTIVE.add(reportId);

  await prisma.job.update({ where: { id: jobId }, data: { status: 'RUNNING' } }).catch(() => {});
  // Recover any client left RUNNING by a killed/duplicate run so it isn't stuck forever.
  await prisma.mibClient.updateMany({ where: { reportId, status: 'RUNNING' }, data: { status: 'PENDING' } });

  const cfg = await getMibConfig();
  // Bizning firmalar — ish undiruvchisini (kreditor) MASKA'langan holda solishtirish uchun. Faqat
  // bizning firmalarga tegishli ishlar SMS bilan chuqur tortiladi; bank/«Давлат» ishlari o'tkaziladi.
  const firms = await prisma.firm.findMany({ select: { shortName: true } });
  const firmWordsList = firms.map((f) => firmKeyWords(f.shortName)).filter((w) => w.length);
  const captcha = new CaptchaSolver();
  let engine = new MibEngine(cfg.baseUrl, { captcha, log });

  try {
    // Preflight the OCR worker FIRST (bundled offline model). If it can't start, fail loudly instead
    // of hanging silently on the first captcha — this was the silent «otmayapti» cause.
    log(`report ${reportId}: OCR (tesseract) ishga tushmoqda…`);
    await captcha.init();
    log(`report ${reportId}: OCR tayyor`);
  } catch (e) {
    await failReport(reportId, jobId, `Captcha (OCR) ishga tushmadi: ${(e as Error).message}`);
    ACTIVE.delete(reportId);
    return;
  }

  // Bring up a session + the (re-usable) debt-search page.
  let debtPage = '';
  const bootSession = async () => {
    const { homeHtml } = await engine.initSession();
    debtPage = await engine.getDebtSearchPage(homeHtml);
  };
  try {
    log(`report ${reportId}: mib.uz sessiya ochilmoqda…`);
    await bootSession();
    log(`report ${reportId}: sessiya tayyor`);
  } catch (e) {
    await failReport(reportId, jobId, `Sessiya ochilmadi: ${(e as Error).message}`);
    await captcha.terminate().catch(() => {});
    ACTIVE.delete(reportId);
    return;
  }

  let processed = 0;
  try {
    while (await stillRunning(reportId)) {
      const client = await prisma.mibClient.findFirst({
        where: { reportId, status: 'PENDING' },
        // «attempts asc» — hali urinilmagan (attempts=0) mijozlar OLDIN; SMS kelmay qayta navbatga
        // tushganlar (attempts>0) qolganlari tugagach oxirida qayta olinadi.
        orderBy: [{ attempts: 'asc' }, { id: 'asc' }],
      });
      if (!client) break; // nothing left → done

      log(`report ${reportId}: [${processed + 1}] PINFL ${client.pinfl} tekshirilmoqda…`);
      await prisma.mibClient.update({ where: { id: client.id }, data: { status: 'RUNNING', attempts: { increment: 1 } } });

      try {
        // Fresh debt-search page per client (matches the reference runner) so the captcha/form is clean.
        debtPage = await engine.getDebtSearchPage((await engine.request('/home').then((r) => r.text())));
        const search = await engine.searchDebtsByPinfl(client.pinfl, debtPage);

        if (!search.success) {
          // Captcha/qidiruv MUVAFFAQIYATSIZ — bu «Toza» EMAS, XATO (qayta urinsa bo'ladi).
          log(`PINFL ${client.pinfl}: qidiruv muvaffaqiyatsiz — ${search.message || 'xato'}`);
          await prisma.mibClient.update({
            where: { id: client.id },
            data: { status: 'FAILED', fio2: search.fio || null, checkedAt: new Date(), error: search.message || 'Qidiruv muvaffaqiyatsiz' },
          });
        } else if (!search.cases || search.cases.length === 0) {
          // Captcha yechildi, qidiruv o'tdi — lekin qarz yo'q → TOZA.
          log(`PINFL ${client.pinfl}: qarz topilmadi (toza)`);
          await prisma.mibClient.update({
            where: { id: client.id },
            data: { status: 'CLEAN', fio2: search.fio || null, totalDebt: search.totalDebt || null, currentDebt: search.currentDebt || null, checkedAt: new Date(), error: null },
          });
        } else {
          await prisma.mibClient.update({
            where: { id: client.id },
            data: { fio2: search.fio || null, totalDebt: search.totalDebt || null, currentDebt: search.currentDebt || null },
          });
          // Eski (oldingi urinishdan qolgan) ishlarni tozalaymiz — qayta urinishда dublikat bo'lmasin.
          await prisma.mibCase.deleteMany({ where: { clientId: client.id } });
          let smsFailed = false;
          let oursCount = 0, otherCount = 0;
          for (const c of search.cases) {
            // Undiruvchi (kreditor) MASKA'langan holda qidiruv ro'yxatida bor — bizning firmamizmi yoki
            // yo'qmi shundan aniqlaymiz. FAQAT bizning ishlarni SMS bilan chuqur tortamiz.
            const ours = creditorIsOurs(c.creditor, firmWordsList);
            const caseRow = await prisma.mibCase.create({
              data: {
                clientId: client.id, workNumber: c.workNumber, monitoringUrl: c.monitoringUrl ?? null,
                firmName: c.creditor ?? null, // MASKA'langan undiruvchi; ours bo'lsa fetchCaseDetail to'liq nom yozadi
              },
            });
            if (!ours) {
              // Boshqa kreditor (bank / «Давлат») — SMS/chuqur detal SO'RALMAYDI (zapros/vaqt tejaladi).
              otherCount += 1;
              await prisma.mibCase.updateMany({ where: { id: caseRow.id }, data: { error: 'Boshqa kreditor — detal olinmadi' } });
              continue;
            }
            oursCount += 1;
            // Chuqur detal (SMS-gated) — FAQAT deepDetail yoqilgan va telefon bo'lsa. O'chirilgan
            // bo'lsa SMS so'ralmaydi, faqat ijro ishi ro'yxati qoladi (tez, «birdan»).
            if (cfg.deepDetail && cfg.phone && c.monitoringUrl) {
              try {
                await fetchCaseDetail(engine, caseRow.id, client.pinfl, c.workNumber, c.monitoringUrl, cfg.phone);
              } catch (e) {
                // updateMany — case o'chirilgan bo'lsa ham yiqilmasin (aks holda butun mijoz XATO bo'lardi).
                const m = (e as Error).message || String(e);
                if (/sms/i.test(m)) smsFailed = true; // SMS kelmadi/so'ralmadi — qayta urinishga arziydi
                await prisma.mibCase.updateMany({ where: { id: caseRow.id }, data: { error: m } });
              }
            } else if (cfg.deepDetail && !cfg.phone) {
              await prisma.mibCase.updateMany({ where: { id: caseRow.id }, data: { error: 'SMS telefon raqami sozlanmagan' } });
            }
          }
          const attemptNo = client.attempts + 1; // shu urinish raqami (attempts DB'да ↑ qilingan)
          if (smsFailed && attemptNo < MAX_SMS_ATTEMPTS) {
            // SMS kod kelmadi — mijozni QAYTA NAVBATGA solamiz (PENDING). Ishlar o'chiriladi (qayta
            // urinishда dublikat bo'lmasin). «attempts asc» tartibi tufayli bu mijoz qolgan (hali
            // urinilmagan) mijozlar ishlanib bo'lgandan KEYIN qayta olinadi — telefon/forwarder shu
            // orada tiklanishi mumkin. MAX_SMS_ATTEMPTS urinishdan keyin baribir DONE (ish detalsiz).
            await prisma.mibCase.deleteMany({ where: { clientId: client.id } });
            await prisma.mibClient.update({
              where: { id: client.id },
              data: { status: 'PENDING', error: `SMS kelmadi — qayta urinadi (${attemptNo}/${MAX_SMS_ATTEMPTS})` },
            });
            log(`report ${reportId}: PINFL ${client.pinfl} → SMS kelmadi, qayta navbatga (${attemptNo}/${MAX_SMS_ATTEMPTS})`);
          } else {
            await prisma.mibClient.update({ where: { id: client.id }, data: { status: 'DONE', checkedAt: new Date() } });
            log(`report ${reportId}: PINFL ${client.pinfl} → ${search.cases.length} ijro (${oursCount} bizniki, ${otherCount} boshqa)${smsFailed ? ` — SMS ${attemptNo} urinishда kelmadi` : ''}`);
          }
        }
      } catch (e) {
        const msg = (e as Error).message || String(e);
        log(`report ${reportId}: PINFL ${client.pinfl} XATO: ${msg}`);
        await prisma.mibClient.update({ where: { id: client.id }, data: { status: 'FAILED', error: msg, checkedAt: new Date() } });
        // Session may have broken — rebuild it so the next client isn't lost.
        try { engine = new MibEngine(cfg.baseUrl, { captcha, log }); await bootSession(); } catch { /* next tick retries */ }
      }

      processed += 1;
      await prisma.job.update({ where: { id: jobId }, data: { progress: processed } }).catch(() => {});

      if (!(await stillRunning(reportId))) break;
      // Pace between clients («1 minutdan ketsin»), but bail out promptly if STOP was pressed.
      const until = Date.now() + cfg.intervalSec * 1000;
      while (Date.now() < until) {
        if (!(await stillRunning(reportId))) break;
        await sleep(Math.min(2000, until - Date.now()));
      }
    }
    // Loop ended: either stopped, or no PENDING left. Clear autoRun + finish the job.
    const remaining = await prisma.mibClient.count({ where: { reportId, status: 'PENDING' } });
    await prisma.mibReport.update({ where: { id: reportId }, data: { autoRun: false, runJobId: null } });
    await prisma.job.update({ where: { id: jobId }, data: { status: 'DONE', message: remaining ? 'Toʻxtatildi' : 'Yakunlandi' } }).catch(() => {});
    log(`report ${reportId}: tugadi (${processed} ta ishlandi, ${remaining} qoldi)`);
  } finally {
    await captcha.terminate().catch(() => {});
    ACTIVE.delete(reportId);
  }
}

/** One case: request SMS → wait for OTP → submit → fetch + persist Step 19 detail. */
async function fetchCaseDetail(engine: MibEngine, caseId: number, pinfl: string, workNumber: string, monitoringUrl: string, phone: string): Promise<void> {
  const requestedAt = Date.now();
  log(`PINFL ${pinfl} · ish ${workNumber}: SMS soʻralmoqda (+${phone})…`);
  const sms = await engine.prepareAndRequestSms(monitoringUrl, pinfl, workNumber, phone);
  log(`PINFL ${pinfl} · ish ${workNumber}: SMS yuborildi, kod kutilmoqda (${SMS_TIMEOUT_MS / 1000}s)…`);
  const code = await waitForSms(requestedAt);
  if (!code) { log(`PINFL ${pinfl} · ish ${workNumber}: SMS kod KELMADI (timeout ${SMS_TIMEOUT_MS / 1000}s) — telefon/forwarder/webhook tekshiring`); throw new Error('SMS kod kelmadi (timeout)'); }
  log(`PINFL ${pinfl} · ish ${workNumber}: SMS kod keldi (••••) — detal olinmoqda`);
  const step19Url = await engine.submitSmsCode(sms.verifyFormAction, code);
  const d = await engine.fetchExecutionDetails(step19Url);
  const firm = resolveCreditor(d.creditor);
  // updateMany — case qayta-tekshirish/reconcile tomonidan o'chirilgan bo'lsa ham «record not found»
  // bilan yiqilmasin (count 0 qaytadi, throw yo'q).
  await prisma.mibCase.updateMany({
    where: { id: caseId },
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
}

async function failReport(reportId: number, jobId: number, message: string): Promise<void> {
  await prisma.mibReport.update({ where: { id: reportId }, data: { autoRun: false, runJobId: null } }).catch(() => {});
  await prisma.job.update({ where: { id: jobId }, data: { status: 'FAILED', message } }).catch(() => {});
}
