// Firma bo'yicha kvitansiyalarni billing.sud.uz dan sahifama-sahifa yig'ish — SERVER tomonda.
// Brauzerga bog'liq emas: foydalanuvchi sahifadan chiqib ketsa ham davom etadi, va worker
// har 2 soatda o'zi qayta yugurtiradi.
//
// Bir vaqtda FAQAT BITTA yig'ish ketadi (foydalanuvchi talabi: yangilanish o'rtasida boshqa
// yuklashga ruxsat berilmasin). Qulf `BillingCheckSync` jadvalida — ya'ni web (qo'lda
// bosilgan) va worker (avtomatik) jarayonlari bir-birini ko'radi, jarayon qayta ishga
// tushsa ham qulf yo'qolmaydi.
import { prisma } from '@/lib/db';
import { FIRMS, type FirmCfg } from '@/lib/firms';
import { searchMyChecks } from './search';
import { upsertCheckedInvoice } from './store';

const PAGE = 50;
// Sahifalar orasidagi pauza — ketma-ket urib IP blokka tushmaslik uchun (invoice-rest.ts
// dagi bilan bir xil mantiq; har so'rov o'z captcha tokenini ham oladi).
const DELAY_MS = 500;
// Shuncha vaqtdan beri RUNNING turgan qator — jarayoni o'lgan, qulfi bo'shatiladi.
const STALE_MS = 15 * 60_000;
// Avtomatik yangilash oralig'i: firma oxirgi marta shuncha vaqt oldin tugagan bo'lsa, navbatga tushadi.
export const AUTO_EVERY_MS = 2 * 60 * 60_000; // 2 soat
// Cheksiz sikl bo'lib qolmasligi uchun qattiq shift (50 × 400 = 20 000 kvitansiya).
const MAX_PAGES = 400;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface SyncState {
  firmCode: string;
  firmName: string;
  status: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  done: number;
  total: number;
  lastCount: number;
  trigger: string | null;
  message: string | null;
}

/** RUNNING bo'lib qotib qolgan qatorlarni bo'shatadi (jarayon o'lgan bo'lsa). */
async function releaseStale(): Promise<void> {
  await prisma.billingCheckSync.updateMany({
    where: { status: 'RUNNING', startedAt: { lt: new Date(Date.now() - STALE_MS) } },
    data: { status: 'FAILED', message: 'Jarayon uzilib qoldi — qayta urinib ko‘ring' },
  });
}

/** Hozir biror firma yig'ilyaptimi. */
export async function isSyncRunning(): Promise<boolean> {
  await releaseStale();
  return (await prisma.billingCheckSync.count({ where: { status: 'RUNNING' } })) > 0;
}

/** Barcha firmalarning holati (UI shu asosda tugmalarni bloklaydi va «oxirgi yangilangan»ni ko'rsatadi). */
export async function getSyncStates(): Promise<SyncState[]> {
  await releaseStale();
  const rows = await prisma.billingCheckSync.findMany();
  return FIRMS.map((f: FirmCfg) => {
    const r = rows.find((x) => x.firmCode === f.branchCode);
    return {
      firmCode: f.branchCode,
      firmName: f.name.replace(/ MIKROMOLIYA.*$/i, ''),
      status: r?.status ?? 'IDLE',
      startedAt: r?.startedAt ?? null,
      finishedAt: r?.finishedAt ?? null,
      done: r?.done ?? 0,
      total: r?.total ?? 0,
      lastCount: r?.lastCount ?? 0,
      trigger: r?.trigger ?? null,
      message: r?.message ?? null,
    };
  });
}

/**
 * Bitta firmani yig'adi. Qulfni egallay olmasa `null` qaytaradi (boshqa yig'ish ketyapti).
 * Qulf global: istalgan firma RUNNING bo'lsa, yangisi boshlanmaydi.
 *
 * `limit` berilsa — faqat eng oxirgi shuncha kvitansiya (billing ro'yxati yangidan eskiga
 * tartiblangan, ya'ni 1-sahifada eng yangilari). Yangi chiqqan kvitansiyalarni tez ilib
 * olish uchun qulay; `limit` berilmasa butun ro'yxat aylanadi.
 */
export async function syncFirm(
  firmCode: string,
  trigger: 'MANUAL' | 'AUTO',
  limit?: number,
): Promise<{ done: number; total: number } | null> {
  const firm = FIRMS.find((f: FirmCfg) => f.branchCode === firmCode);
  if (!firm) throw new Error(`Firma topilmadi: ${firmCode}`);

  await releaseStale();
  // Global qulf: boshqa firma ketayotgan bo'lsa ham to'xtaymiz.
  if (await prisma.billingCheckSync.count({ where: { status: 'RUNNING' } })) return null;

  // Qatorni bor qilamiz, so'ng ATOMAR egallaymiz (status RUNNING bo'lmagan holatdagina).
  await prisma.billingCheckSync.upsert({
    where: { firmCode }, create: { firmCode, status: 'IDLE' }, update: {},
  });
  const claimed = await prisma.billingCheckSync.updateMany({
    where: { firmCode, status: { not: 'RUNNING' } },
    data: { status: 'RUNNING', startedAt: new Date(), done: 0, total: 0, trigger, message: null },
  });
  if (claimed.count === 0) return null; // poygada yutqazdik

  const want = limit && limit > 0 ? limit : null;
  let done = 0;
  let total = 0;
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      // Oxirgi N so'ralganda oxirgi sahifada ortiqcha tortmaymiz.
      const size = want ? Math.min(PAGE, want - done) : PAGE;
      if (size <= 0) break;
      const res = await searchMyChecks({ inn: firm.stir, page, size });
      total = res.totalElements || total;
      for (const row of res.content) {
        await upsertCheckedInvoice({
          number: row.number, invoiceStatus: row.invoiceStatus,
          amount: row.amount, paidAmount: row.paidAmount, mustPayAmount: row.mustPayAmount,
          balance: row.balance, payer: row.payer, payerTin: row.payerTin,
          court: row.court, courtId: row.courtId, forAccount: row.forAccount,
          description: row.description, payCategory: row.payCategory,
          claimCaseNumber: row.claimCaseNumber,
          issuedAt: row.issued ? new Date(row.issued) : null,
          expiresAt: row.overdue ? new Date(row.overdue) : null,
          source: 'LIST', raw: row.raw,
        });
        done++;
      }
      await prisma.billingCheckSync.update({ where: { firmCode }, data: { done, total } });
      if (res.last || res.content.length === 0) break;
      if (want && done >= want) break;
      await sleep(DELAY_MS);
    }

    await prisma.billingCheckSync.update({
      where: { firmCode },
      data: {
        status: 'IDLE', done, total, lastCount: done, message: null,
        // Qisman yig'ish (oxirgi N) «to'liq yangilandi» hisoblanmaydi — aks holda avtomatik
        // jadval butun ro'yxatni keyingi oralig'gacha kechiktirib yuborardi.
        ...(want ? {} : { finishedAt: new Date() }),
      },
    });
    return { done, total };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Yig‘ishda xato';
    await prisma.billingCheckSync.update({
      where: { firmCode },
      // finishedAt YANGILANMAYDI — muvaffaqiyatsiz yugurish «yangilandi» deb hisoblanmaydi,
      // shuning uchun avtomatik jadval uni tez orada qayta urinib ko'radi.
      data: { status: 'FAILED', done, total, message: `${message} (${done} ta olindi)` },
    });
    // Xatolar tarixda ko'rinsin (muvaffaqiyatli AVTO yugurishlar tarixni to'ldirmaydi).
    await prisma.billingCheckQuery.create({
      data: {
        createdBy: trigger === 'AUTO' ? 'avtomatik' : null, mode: 'LIST', query: firm.stir,
        resultCount: done, status: 'FAILED', message: `${message} (${done} ta olindi)`,
      },
    }).catch(() => {});
    throw e;
  }
}

/** Oxirgi muvaffaqiyatli yakunidan AUTO_EVERY_MS o'tgan firmalar (avtomatik navbat). */
export async function firmsDueForSync(): Promise<string[]> {
  const rows = await prisma.billingCheckSync.findMany();
  const cutoff = Date.now() - AUTO_EVERY_MS;
  return FIRMS
    .filter((f: FirmCfg) => {
      const r = rows.find((x) => x.firmCode === f.branchCode);
      if (!r) return true; // hech qachon yig'ilmagan
      if (r.status === 'RUNNING') return false;
      return !r.finishedAt || r.finishedAt.getTime() < cutoff;
    })
    .map((f: FirmCfg) => f.branchCode);
}
