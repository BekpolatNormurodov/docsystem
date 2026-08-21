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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SMS_TIMEOUT_MS = 120_000;
const log = (m: string) => console.log(`[mib] ${m}`);

// In-process guard: prevents a second GO from spawning a duplicate loop for the SAME report (which is
// how two clients ended up RUNNING at once). Survives only within one web process — a restart clears it,
// so pressing GO after a restart correctly resumes.
const ACTIVE = new Set<number>();
export const isMibRunActive = (reportId: number): boolean => ACTIVE.has(reportId);

/** Poll the MibSms table for an OTP that arrived AFTER `sinceMs`, marking it consumed. */
async function waitForSms(sinceMs: number, timeoutMs = SMS_TIMEOUT_MS): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await prisma.mibSms.findFirst({
      where: { consumed: false, createdAt: { gte: new Date(sinceMs) } },
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
        orderBy: { id: 'asc' },
      });
      if (!client) break; // nothing left → done

      log(`report ${reportId}: [${processed + 1}] PINFL ${client.pinfl} tekshirilmoqda…`);
      await prisma.mibClient.update({ where: { id: client.id }, data: { status: 'RUNNING', attempts: { increment: 1 } } });

      try {
        // Fresh debt-search page per client (matches the reference runner) so the captcha/form is clean.
        debtPage = await engine.getDebtSearchPage((await engine.request('/home').then((r) => r.text())));
        const search = await engine.searchDebtsByPinfl(client.pinfl, debtPage);

        if (!search.success || !search.cases || search.cases.length === 0) {
          await prisma.mibClient.update({
            where: { id: client.id },
            data: { status: 'CLEAN', fio2: search.fio || null, totalDebt: search.totalDebt || null, currentDebt: search.currentDebt || null, checkedAt: new Date(), error: search.success ? null : (search.message || null) },
          });
        } else {
          await prisma.mibClient.update({
            where: { id: client.id },
            data: { fio2: search.fio || null, totalDebt: search.totalDebt || null, currentDebt: search.currentDebt || null },
          });
          for (const c of search.cases) {
            const caseRow = await prisma.mibCase.create({
              data: { clientId: client.id, workNumber: c.workNumber, monitoringUrl: c.monitoringUrl ?? null },
            });
            // Deep detail (SMS-gated). Needs a configured phone; otherwise leave the case at search level.
            if (cfg.phone && c.monitoringUrl) {
              try {
                await fetchCaseDetail(engine, caseRow.id, client.pinfl, c.workNumber, c.monitoringUrl, cfg.phone);
              } catch (e) {
                await prisma.mibCase.update({ where: { id: caseRow.id }, data: { error: (e as Error).message } });
              }
            } else if (!cfg.phone) {
              await prisma.mibCase.update({ where: { id: caseRow.id }, data: { error: 'SMS telefon raqami sozlanmagan' } });
            }
          }
          await prisma.mibClient.update({ where: { id: client.id }, data: { status: 'DONE', checkedAt: new Date() } });
          log(`report ${reportId}: PINFL ${client.pinfl} → ${search.cases.length} ijro ishi`);
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
  const sms = await engine.prepareAndRequestSms(monitoringUrl, pinfl, workNumber, phone);
  const code = await waitForSms(requestedAt);
  if (!code) throw new Error('SMS kod kelmadi (timeout)');
  const step19Url = await engine.submitSmsCode(sms.verifyFormAction, code);
  const d = await engine.fetchExecutionDetails(step19Url);
  const firm = resolveCreditor(d.creditor);
  await prisma.mibCase.update({
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
