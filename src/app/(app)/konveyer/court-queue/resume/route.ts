import { NextRequest, NextResponse } from 'next/server';
import { requireStep } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { enqueueJob } from '@/lib/job-dispatch';
import { FIRM_REQUIRED_DOCS, FIRM_DOC_LABEL } from '@/lib/court-ready';
import { isQueuePaused } from '@/lib/cabinet/pacer';
import { MAX_COURT_BATCH } from '@/lib/court-batch';

export const runtime = 'nodejs';

// POST { firmId, limit?, retryFailed? } — navbatda QOLGAN ishlarni davom ettirish.
//
// `retryFailed: true` — XATO bergan / SUD RAD ETGAN ishlarni qaytadan navbatga qo'yish.
// Bu ALOHIDA, ATAYIN operator amali: avtomatika xato bergan ishni 3 urinishdan keyin
// tinch qo'yadi (sabab odatda doimiy — hujjat, sud sozlamasi, boji), ya'ni kamchilik
// tuzatilgach ularni qaytadan yo'lga solish uchun qo'lda tugma kerak. 2026-09-08 da
// aynan shu holat bo'ldi: Yuqorichirchiq 308 ta ishni hujjat tartibi uchun rad etdi,
// tartib kodda tuzatildi, lekin 308 ta ishni qayta yuborishning YO'LI yo'q edi.
//
// «Sudga yuborish» partiya tanlashdan boshlanadi (tayyor ishlardan N ta). Bu esa boshqa
// holat: partiya allaqachon tuzilgan, bir qismi ketgan, qolgani `CourtQueueItem` da PENDING
// bo'lib turibdi (worker uzilgani, pauza yoki sahifa yangilangani sababli). Bunda YANGI
// tanlov qilinmaydi — aynan o'sha qolgan ishlar davom ettiriladi, tartibi buzilmaydi va
// hech narsa takrorlanmaydi.
export async function POST(req: NextRequest) {
  await requireStep('sud:send');
  const body = await req.json().catch(() => ({}));
  const firmId = Number(body?.firmId);
  if (!Number.isInteger(firmId) || firmId <= 0) {
    return NextResponse.json({ error: 'firmId kerak' }, { status: 400 });
  }

  if (await isQueuePaused()) {
    return NextResponse.json(
      { error: 'Sudga yuborish jarayoni pauzada. Avval «Davom ettirish» tugmasi bilan yoqing.' },
      { status: 409 },
    );
  }

  // Firma hujjatlari to'liq bo'lmasa davom ettirmaymiz — paket chala ketmasin
  // (prepare-ready bilan bir xil shart).
  const haveDocs = new Set(
    (await prisma.firmDocument.findMany({ where: { firmId }, select: { kind: true } })).map((d) => String(d.kind)),
  );
  const missDocs = FIRM_REQUIRED_DOCS.filter((k) => !haveDocs.has(k));
  if (missDocs.length) {
    return NextResponse.json(
      { error: `Firma hujjatlari yetishmaydi: ${missDocs.map((k) => FIRM_DOC_LABEL[k] ?? k).join(', ')}.` },
      { status: 400 },
    );
  }

  // TAKROR JOB'NI TO'SISH. 2026-09-07: URBAN uchun 16 soniya farq bilan IKKITA job yaralgan
  // (206 RUNNING 3/9 va 207 PENDING 0/9 — bir xil 9 ta ish). Sabab: bu endpoint RUNNING
  // holatdagi ishlarni ham olib ketardi, ya'ni ketayotgan partiyani qaytadan navbatga
  // qo'yardi. Ikki qatlamli himoya:
  //   1) shu firmada faol job bo'lsa — umuman yangi job yaratmaymiz;
  //   2) faqat PENDING ishlar olinadi (RUNNING — boshqa job egallagan).
  // Faol partiyalarning HAMMASI ko'rib chiqiladi (findFirst bitta tasodifiy job olardi va
  // boshqa firma ketayotganda bu firmaning takroriga to'siq jim ishlamasdi).
  const actives = await prisma.job.findMany({
    where: { type: 'COURT_SUBMIT', status: { in: ['PENDING', 'RUNNING'] } },
    select: { id: true, status: true, params: true },
  });
  const active = actives.find((j) => Number((j.params as { firmId?: number } | null)?.firmId) === firmId);
  if (active) {
    return NextResponse.json(
      { error: `Bu firma uchun partiya allaqachon ${active.status === 'RUNNING' ? 'ketmoqda' : 'navbatda'} (#${active.id}). Tugashini kuting.` },
      { status: 409 },
    );
  }

  const limit = Math.min(MAX_COURT_BATCH, Math.max(1, Number(body?.limit) || MAX_COURT_BATCH));
  const retryFailed = body?.retryFailed === true;

  // ADOLAT'da ISHI BOR case QAYTA YUBORILMAYDI — bu eng muhim shart.
  //
  // FAILED har doim «sudga ketmadi» degani emas: `save-suit` o'tib, `send-to-court`
  // uzilgan bo'lishi mumkin — ya'ni da'vo rasman berilgan, bizda esa xato yozilgan.
  // Bunday ishni qayta yuborish AYNI ODAMGA IKKINCHI da'vo ochadi. Sud rad etgan ishlarda
  // `courtCaseId` outcome-sync tomonidan tozalanadi (id `meta.declinedCaseId` da qoladi),
  // shuning uchun ular bu filtrdan bemalol o'tadi.
  const items = await prisma.courtQueueItem.findMany({
    where: retryFailed
      ? { firmId, state: 'FAILED', case: { courtCaseId: null } }
      : { firmId, state: 'PENDING' },
    select: { caseId: true },
    orderBy: { id: 'asc' },
    take: limit,
  });
  if (!items.length) {
    return NextResponse.json(
      { error: retryFailed ? 'Qayta yuboriladigan (xato bergan) ish yo‘q' : 'Bu firmada navbatda qolgan ish yo‘q' },
      { status: 400 },
    );
  }

  const caseIds = items.map((i) => i.caseId);
  if (retryFailed) {
    // Urinishlar sanog'i NOLLANADI: bu operatorning ATAYIN qarori (kamchilik tuzatildi),
    // shuning uchun avtomatikaning «3 urinishdan keyin tinch qo'y» qoidasi qaytadan
    // boshlanishi kerak — aks holda ish bitta urinishdan keyin yana chetga chiqib qolardi.
    await prisma.courtQueueItem.updateMany({
      where: { caseId: { in: caseIds } },
      data: { state: 'PENDING', attempts: 0, lastError: null, step: null, finishedAt: null },
    });
  }
  const snap = await prisma.snapshot.findFirst({ orderBy: { reportDate: 'desc' }, select: { id: true } });

  const job = await prisma.job.create({
    data: {
      type: 'COURT_SUBMIT',
      status: 'PENDING',
      snapshotId: snap?.id ?? null,
      total: caseIds.length,
      params: { firmId, snapshotId: snap?.id, caseIds, ready: true, talabnomaPdf: true, includeGrafik: false, markExported: true },
    },
  });
  enqueueJob(job.id);

  return NextResponse.json({ jobId: job.id, type: 'COURT_SUBMIT', total: caseIds.length, resumed: true });
}
