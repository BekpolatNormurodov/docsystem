import { NextRequest, NextResponse } from 'next/server';
import { requireStep } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { enqueueJob } from '@/lib/job-dispatch';
import { FIRM_REQUIRED_DOCS, FIRM_DOC_LABEL } from '@/lib/court-ready';
import { isFirmPaused } from '@/lib/cabinet/pacer';
import { MAX_COURT_BATCH } from '@/lib/court-batch';
import { getT } from '@/lib/i18n/server';

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
//
// 2026-09-19: REAL REJIM BU YERDAN OLIB TASHLANDI. Real yuborish endi FAQAT «Sudga o'tkazish»
// (/sud 3-tab, /konveyer/sud-send) orqali — saqlangan suit'ni E-IMZO tasdig'i bilan send-to-court.
// Eski real navbat ishi (suitMode=false, draftMode=false) bu route orqali davom ettirilsa,
// runCourtSubmitJob uni TO'LIQ real yo'ldan (yangi qoralama + save-suit + send-to-court) o'tkazardi:
// prod'da CABINET_ALLOW_SEND_TO_COURT=1, ya'ni umumiy pauza ochilishi bilan (3-tab uchun ochiladi)
// bu navbat ham uyg'onib ketardi. Endi faqat qoralama/suit (sudga hech narsa yubormaydigan) ishlar
// davom ettiriladi; faqat real ishlar qolgan bo'lsa — 400 va operatorga yo'l ko'rsatiladi.
const NO_SEND_ITEM = { OR: [{ suitMode: true }, { draftMode: true }] };

export async function POST(req: NextRequest) {
  await requireStep('sud:send');
  const t = getT();
  const body = await req.json().catch(() => ({}));
  const firmId = Number(body?.firmId);
  if (!Number.isInteger(firmId) || firmId <= 0) {
    return NextResponse.json({ error: t('firmId kerak') }, { status: 400 });
  }

  // PAUZA: bu route endi faqat qoralama/suit partiya yaratadi — ular sudga yubormaydi, shuning uchun
  // UMUMIY «Sudga yuborish» pauzasi (real yuborish kaliti) ularni to'smaydi (draftAutoTick va
  // avto-davom bilan bir xil semantika). FIRMA pauzasi esa har doim hurmat qilinadi: aks holda job
  // yaratilib, dvigatel ichida darrov «pauza» deb 0 ta ish bilan tugardi.
  if (await isFirmPaused(firmId)) {
    return NextResponse.json(
      { error: t('Bu firma pauzada. Avval firma pauzasini oching.') },
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
      { error: `${t('Firma hujjatlari yetishmaydi')}: ${missDocs.map((k) => FIRM_DOC_LABEL[k] ?? k).join(', ')}.` },
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
      { error: `${t('Bu firma uchun partiya allaqachon')} ${active.status === 'RUNNING' ? t('ketmoqda') : t('navbatda')} (#${active.id}). ${t('Tugashini kuting.')}` },
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
  const baseWhere = retryFailed
    ? { firmId, state: 'FAILED' as const, case: { courtCaseId: null } }
    : { firmId, state: 'PENDING' as const };
  const items = await prisma.courtQueueItem.findMany({
    // FAQAT qoralama/suit ishlari (yuqoridagi izoh) — real rejimdagilar tanlanmaydi.
    where: { ...baseWhere, ...NO_SEND_ITEM },
    select: { caseId: true, draftMode: true, suitMode: true },
    orderBy: { id: 'asc' },
    take: limit,
  });
  if (!items.length) {
    const realLeft = await prisma.courtQueueItem.count({ where: { ...baseWhere, suitMode: false, draftMode: false } });
    if (realLeft > 0) {
      return NextResponse.json(
        { error: `${t('Real (sudga) yuborish endi faqat «Sudga o‘tkazish» bo‘limida — navbatdagi real ishlar avtomat davom ettirilmaydi.')} (${realLeft})` },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: retryFailed ? t('Qayta yuboriladigan (xato bergan) ish yo‘q') : t('Bu firmada navbatda qolgan ish yo‘q') },
      { status: 400 },
    );
  }

  const caseIds = items.map((i) => i.caseId);
  // REJIMNI SAQLAYMIZ (qoralama / suit). Suit ustun (aralash suit+qoralama → suit). Tanlov
  // yuqorida faqat send-to-court qilMAYDIGAN ishlarga cheklangan — noSend har doim true bo'lishi
  // kerak; baribir ikkinchi qatlam sifatida tekshiriladi (real partiya bu yerdan HECH QACHON chiqmasin).
  const suitMode = items.some((i) => i.suitMode === true);
  const draftMode = !suitMode && items.some((i) => i.draftMode === true);
  const noSend = suitMode || draftMode;
  if (!noSend) {
    return NextResponse.json(
      { error: t('Real (sudga) yuborish endi faqat «Sudga o‘tkazish» bo‘limida — navbatdagi real ishlar avtomat davom ettirilmaydi.') },
      { status: 400 },
    );
  }
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
      params: { firmId, snapshotId: snap?.id, caseIds, ready: true, talabnomaPdf: true, includeGrafik: false, markExported: !noSend, draftMode, suitMode },
    },
  });
  enqueueJob(job.id);

  return NextResponse.json({ jobId: job.id, type: 'COURT_SUBMIT', total: caseIds.length, resumed: true });
}
