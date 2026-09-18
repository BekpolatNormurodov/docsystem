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
import { checkInvoiceStatus } from '@/lib/billing/invoice';

// Sahifa hajmi. *.sud.uz IP'ni ~100-120 so'rovdan keyin bloklaydi (2026-09 kuzatuvi), har sahifa
// esa 2 ta so'rov (captcha + qidiruv). 50 lik sahifada COMMUNITY'ning 2890 kvitansiyasi ~116
// so'rov edi — yolg'iz o'zi blokka yetardi. API 500 ni qabul qiladi (2026-09-18 jonli sinov:
// 6 sahifa, ~12 so'rov).
const PAGE = 500;
// Sahifalar orasidagi pauza — ketma-ket urib IP blokka tushmaslik uchun (invoice-rest.ts
// dagi bilan bir xil mantiq; har so'rov o'z captcha tokenini ham oladi).
const DELAY_MS = 500;
// Shuncha vaqtdan beri RUNNING turgan qator — jarayoni o'lgan, qulfi bo'shatiladi.
const STALE_MS = 15 * 60_000;
// Avtomatik yangilash oralig'i: firma oxirgi marta shuncha vaqt oldin tugagan bo'lsa, navbatga tushadi.
export const AUTO_EVERY_MS = 2 * 60 * 60_000; // 2 soat
// Cheksiz sikl bo'lib qolmasligi uchun qattiq shift (500 × 40 = 20 000 kvitansiya).
const MAX_PAGES = 40;
// Ro'yxatda CHIQMAYDIGAN o'z kvitansiyalarimizni bittalab tekshirish chegarasi (bir yig'ishda).
// Har biri 1 so'rov; shift va pauza IP blokka tushmaslik uchun — qolgani keyingi yig'ishda.
const RECHECK_MAX = 40;
const RECHECK_DELAY_MS = 3000;

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
  const seen = new Set<string>();
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
        seen.add(row.number);
        done++;
      }
      await prisma.billingCheckSync.update({ where: { firmCode }, data: { done, total } });
      if (res.last || res.content.length === 0) break;
      if (want && done >= want) break;
      await sleep(DELAY_MS);
    }

    // To'liq yig'ishdan keyin — ro'yxatda chiqmagan o'z kvitansiyalarimiz (qisman yig'ishda
    // «ko'rilmagan» degani «ro'yxatda yo'q» emas, shuning uchun faqat to'liqida).
    const rechecked = want ? 0 : await recheckUnlistedCaseReceipts(firmCode, seen);
    if (rechecked) console.log(`[billing-check] ${firmCode}: ro'yxatda yo'q ${rechecked} ta kvitansiya bittalab tekshirildi`);

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

/**
 * Firma ishlariga biriktirilgan (ArizaCase.receiptNumber), lekin STIR ro'yxatida CHIQMAGAN
 * kvitansiyalarni bittalab (ommaviy checkStatus, captcha'siz) tekshirib keshga yozadi.
 *
 * NEGA: 2026-09-18 da COMMUNITY'ning 227 ta kvitansiyasi (biz REST orqali yaratganmiz, payer =
 * COMMUNITY, TIN mos) my-checks ro'yxatida umuman chiqmadi. «Tayyor» esa to'lovni FAQAT keshdan
 * o'qiydi (court-ready → paidReceiptSet), ya'ni ular to'langanda ham tizim buni hech qachon
 * sezmasdi va ishlar abadiy «boji to'lanmagan» bo'lib qolardi.
 *
 * Faqat yakuniy holatga yetmaganlar (keshda yo'q yoki PAID/USED emas), eng uzoq
 * tekshirilmaganlar birinchi, bir yig'ishda RECHECK_MAX tadan — qolgani keyingi yig'ishda.
 * Tarmoq/blok xatosida darhol to'xtaydi: IP'ni qizdirib qo'ymaslik uchun.
 */
export async function recheckUnlistedCaseReceipts(firmCode: string, seen: Set<string>): Promise<number> {
  const firm = await prisma.firm.findFirst({ where: { code: firmCode }, select: { id: true } });
  if (!firm) return 0;
  const cases = await prisma.arizaCase.findMany({
    where: { firmId: firm.id, receiptNumber: { not: null } },
    select: { receiptNumber: true },
  });
  const numbers = [...new Set(cases.map((c) => c.receiptNumber as string).filter((n) => n && !seen.has(n)))];
  if (!numbers.length) return 0;

  const cached = await prisma.billingCheckInvoice.findMany({
    where: { number: { in: numbers } },
    select: { number: true, invoiceStatus: true, checkedAt: true },
  });
  const byNum = new Map(cached.map((c) => [c.number, c]));
  const FINAL = new Set(['PAID', 'USED']);
  const todo = numbers
    .filter((n) => !FINAL.has(String(byNum.get(n)?.invoiceStatus ?? '').toUpperCase()))
    .sort((a, b) => (byNum.get(a)?.checkedAt?.getTime() ?? 0) - (byNum.get(b)?.checkedAt?.getTime() ?? 0))
    .slice(0, RECHECK_MAX);

  let checked = 0;
  for (const num of todo) {
    try {
      const b = await checkInvoiceStatus(num);
      await upsertCheckedInvoice({
        number: b.number || num,
        invoiceStatus: b.invoiceStatus,
        amount: b.amount ?? null,
        paidAmount: b.paidAmount ?? null,
        mustPayAmount: b.mustPayAmount ?? null,
        payer: b.payer ?? null,
        payerTin: b.payerTin ?? null,
        court: b.court ?? null,
        courtId: b.courtId ?? null,
        forAccount: b.forAccount ?? null,
        description: b.description ?? null,
        payCategory: b.payCategory ?? null,
        claimCaseNumber: b.claimCaseNumber ?? null,
        source: 'SINGLE',
        raw: b.raw,
      });
      checked++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Portal «bunday kvitansiya yo'q» deb javob bersa — o'tkazib ketamiz; tarmoq/blok bo'lsa — to'xtaymiz.
      if (/fetch failed|abort|timeout|ECONN|ETIMEDOUT|EAI_AGAIN|network/i.test(msg)) break;
    }
    await sleep(RECHECK_DELAY_MS);
  }
  return checked;
}
