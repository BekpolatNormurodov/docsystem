// «Sudga yuborish» tayyorlik + real status hisoboti. Bir mijoz (case) sudga
// CHIQARILISHI uchun 5 SHART (grafik SHART EMAS):
//   1) Talabnoma yuborilgan  (talabnomaAt)
//   2) Palatadan imzolangan skan SHU case'ga biriktirilgan (CaseDocument SIGNED_ARIZA)
//   3) Oferta — har shartnomaga  (firma portfelida summKr>0 loan bor)
//   4) Talabnoma «check» — UZPOST kvitansiyasi SHU case'ga biriktirilgan (CaseDocument TALABNOMA_RECEIPT)
//   5) Invoice RAQAMI bor (receiptNumber) — raqam ariza ichiga yoziladi (`boji`)
// Invoice/kvitansiya PDF'i sudga KETMAYDI (ariza bojisiz), LEKIN raqami (receiptNumber)
// bo'lmasa ariza chala — shu sabab `boji` endi MAJBURIY gate (foydalanuvchi qarori).
// Bu modul faqat DB o'qiydi — chiqarilgan-yo'qligini ArizaCase.meta.exportedAt
// da saqlaymiz (schema o'zgarmasdan, db push kerak emas).
import { prisma } from './db';
import { MAX_COURT_BATCH } from './court-batch';
// Tab sonlari qoidasi — brauzer bilan YAGONA manba (court-counts.ts izohiga qarang).
import { tallyClientCounts, emptyClientCounts, type ClientReadyCounts } from './court-counts';
import type { CaseStage } from '@prisma/client';
import { STAGE_LABEL } from './konveyer';
import { performLabel } from './hippo/mail-status';

// Sudga allaqachon chiqib bo'lgan / yopilgan bosqichlar — «yuborishga tayyor»
// tanloviga kirmaydi (COURT_RETURNED esa qayta chiqishi kerak, shuning uchun bu
// yerda EMAS).
const SENT_STAGES = new Set<CaseStage>(['COURT_SUBMITTED', 'COURT_ACCEPTED', 'MIB_SUBMITTED', 'CLOSED']);

export interface DocFlags {
  talabnoma: boolean;
  scan: boolean;
  oferta: boolean;
  receipt: boolean;   // talabnoma «check» (UZPOST kvitansiya) SHU case'ga biriktirilgan — MAJBURIY
  boji: boolean;
  ready: boolean;
  exported: boolean;  // ZIP paketi chiqarilgan YOKI sudga yuborilgan — «ishlov ko'rgan»
  /**
   * ADOLAT'da bu odamga SHU FIRMA nomidan da'vo BOR, lekin uni biz yubormaganmiz —
   * yurist portalda qo'lda kiritgan.
   *
   * 2026-09-08 o'lchovi: portalda 3 173 ta ish bor, ulardan 433 tasining bizda izi yo'q,
   * va 391 tasi bizning navbatimizda «yuborishga tayyor» bo'lib turgan edi. Ya'ni
   * avtomatika o'sha odamlarga IKKINCHI da'vo ochib yuborishi mumkin edi.
   *
   * MOSLIK FAQAT ANIQ: `ClientCaseStatus.matchedBy = 'PINFL'` (detal so'rovdan olingan
   * javobgar PINFL'i bizning portfelimizdagi mijozga to'g'ri kelgan). Ism bo'yicha
   * taxmin ATAYIN hisobga olinmaydi — operator qarori: taxminga tayanib haqiqiy
   * qarzdorni konveyerdan chiqarib yuborish mumkin emas.
   */
  submittedExternal: boolean;
  // SUDGA HAQIQATAN yuborilgan (stage COURT_SUBMITTED/... yoki courtCaseId bor).
  //
  // NEGA `exported`dan ajratildi: 2026-09-07 da BRIGHT qatorida «Yuborilgan 100» ko'rindi,
  // lekin ularning BITTASI ham sudga ketmagan edi — 100 tasida faqat ZIP paketi
  // chiqarilgan (meta.exportedAt). Operator ularni sudda deb o'ylashi mumkin edi.
  // Endi ikkisi alohida: «Chiqarilgan» (ZIP) va «Sudda» (haqiqiy da'vo).
  submitted: boolean;
  draft: boolean;     // meta.draftAt & !exported — «Qoralama» (sinab ko'rilgan, hali haqiqiy emas)
  /** ADOLAT'da to'liq qoralama TAYYORLANGAN (meta.draftReadyAt) — yurist portalda yuboradi.
   *  «Tayyor» EMAS: qoralama allaqachon tayyor, qayta tayyorlash shart emas. */
  draftReady: boolean;
  /**
   * NAVBATDA — bu ish allaqachon partiyaga olingan (CourtQueueItem PENDING/RUNNING),
   * lekin hali sudga yetib bormagan.
   *
   * NEGA ALOHIDA HOLAT: 2026-09-07 da BRIGHT'da 291 ta tayyor bor edi, operator 200 tasini
   * navbatga berdi — va ro'yxat baribir «Tayyor 291» deb turaverdi, keyingi modalda ham
   * «max 200» chiqdi. Ya'ni navbatdagi 200 ta ish IKKI marta sanalardi: bir marta
   * «navbatda», bir marta «hali yuborilmagan tayyor». Operator uchun bu «hech narsa
   * kamaymadi» degan ma'noni berardi va u qayta-qayta bosishga urinardi.
   */
  queued: boolean;
  sendable: boolean;  // «Tayyor» — ready && qoralama/navbat/sudda EMAS
}

interface CaseRow {
  id: number;
  pinfl: string | null;
  stage: CaseStage;
  talabnomaAt: Date | null;
  receiptNumber: string | null;
  courtCaseId?: string | null;
  courtId?: number | null; // biz biriktirgan sud — sud kesimidagi tallilar uchun (flagsFor ishlatmaydi)
  meta: unknown;
}

function metaHas(meta: unknown, key: string): boolean {
  return !!(meta && typeof meta === 'object' && !Array.isArray(meta) && (meta as Record<string, unknown>)[key]);
}
function isExported(meta: unknown): boolean { return metaHas(meta, 'exportedAt'); }
function isDraftMeta(meta: unknown): boolean { return metaHas(meta, 'draftAt'); }

function flagsFor(c: CaseRow, signedCaseIds: Set<number>, receiptCaseIds: Set<number>, ofertaPinfls: Set<string>, paidReceipts?: Set<string>, queuedCaseIds?: Set<number>, portalCases?: { portal: Set<string>; manual: Set<string> }): DocFlags {
  const talabnoma = !!c.talabnomaAt;
  // SKAN = imzolangan ariza SHU case'ga biriktirilgan (CaseDocument SIGNED_ARIZA) — paket
  // bilan bir xil manba. Ilgari global PINFL to'plami ishlatilardi: bir odam (PINFL) boshqa
  // firmada skanlansa yoki OCR o'qilib hali biriktirilmasa ham «✓» yonardi (soxta tayyor).
  const scan = signedCaseIds.has(c.id);
  const oferta = !!(c.pinfl && ofertaPinfls.has(c.pinfl));
  // CHECK = talabnoma UZPOST kvitansiyasi SHU case'ga biriktirilgan (CaseDocument
  // TALABNOMA_RECEIPT). MAJBURIY (foydalanuvchi qarori): check'siz sudga chala ketmasin.
  const receipt = receiptCaseIds.has(c.id);
  // `boji` = invoice RAQAMI (receiptNumber) bor. Invoice PDF sudga ketmaydi, ammo raqami
  // ariza ichiga yoziladi — raqamsiz ariza chala, shuning uchun `boji` MAJBURIY gate.
  // `boji` = kvitansiya raqami bor VA U TO'LANGAN. To'lanmagani portalda 400 beradi, ya'ni
  // «tayyor» deb ko'rsatish yolg'on bo'lardi. `paidReceipts` berilmagan eski chaqiruvlarda
  // eski xatti-harakat saqlanadi (faqat raqam borligi).
  const boji = !!c.receiptNumber && (!paidReceipts || paidReceipts.has(c.receiptNumber));
  const ready = talabnoma && scan && oferta && receipt && boji;
  // «Yuborilgan» — meta.exportedAt (ZIP paket chiqarilgani) YOKI bosqichi allaqachon sudda.
  //
  // Nega ikkalasi: 2026-09-07 da API orqali HAQIQATAN sudga topshirilgan ish (stage
  // COURT_SUBMITTED) hech qaysi ro'yxatda ko'rinmay qoldi — «Tayyor»dan SENT_STAGES sababli
  // chiqib ketdi, «Yuborilgan»ga esa meta.exportedAt yo'qligi uchun tushmadi. API oqimi
  // exportedAt yozmaydi (u ZIP eksportining belgisi), shuning uchun bosqichning o'zi ham
  // hisobga olinadi.
  // `courtCaseId` — ADOLAT'da ish ALLAQACHON yaratilgan. Bosqich hali COURT_SUBMITTED
  // bo'lmasligi mumkin (yakuniy qadam uzilgan), lekin da'vo rasman berilgan bo'lishi
  // ehtimoli bor — shuning uchun bunday ish QAYTA yuborilmaydi. Aks holda bir odamga
  // ikkita da'vo ochilardi (2026-09-07 auditida topilgan).
  // QO'LDA KIRITILGAN DA'VO — biz yubormaganmiz, lekin portalda BOR.
  //
  // Yuristlar ADOLAT'da to'g'ridan-to'g'ri ham ish qo'yishadi (2026-09-08: 433 ta shunday
  // ish topildi, 25-avgustdan buyon). Bizning tizim ular haqida bilmasa, o'sha odamlarni
  // «Tayyor» deb ko'rsatib qayta yuboradi va AYNI ODAMGA IKKINCHI da'vo ochiladi —
  // qaytarib bo'lmaydigan xato. Shuning uchun bunday ish `submitted` hisoblanadi.
  // «Sudda N+M»: N = BIZ yuborganimiz (courtCaseId/SENT_STAGES), M = YURIST QO'LDA KIRITGANI
  // (portalda ochiq faol da'vo bor, biz yubormaganmiz). `manual` allaqachon biznikilarni va
  // eski hal bo'lgan ishlarni chiqarib tashlaydi (portalCasePinfls).
  const isOurs = SENT_STAGES.has(c.stage) || !!c.courtCaseId;
  const submittedExternal = !isOurs && !!c.pinfl && (portalCases?.manual.has(c.pinfl) ?? false);
  const submitted = isOurs || submittedExternal;
  const exported = isExported(c.meta) || submitted;
  const draft = !exported && isDraftMeta(c.meta); // qoralama-sinov qilingan, hali haqiqiy yuborilmagan
  // QORALAMA TAYYOR — ADOLAT'da to'liq tayyorlangan (prepareDraftOnly), yurist yuboradi.
  // Bu case «Tayyor» ro'yxatidan CHIQADI: qoralama bor, uni qayta tayyorlash ADOLAT'da
  // ikkinchi yetim qoralama yaratardi va operatorga «Tayyor» soni kamaymaganday ko'rinardi.
  // draftReady = tayyorlangan (stop-A qoralama YOKI stop-B «Murojaatlarim» ishi) — «Tayyor»dan
  // chiqadi, qayta tayyorlanmaydi (aks holda ikkinchi qoralama/real ish ochilardi).
  const draftReady = !submitted && (metaHas(c.meta, 'draftReadyAt') || metaHas(c.meta, 'suitReadyAt'));
  // «Tayyor» = ready va SUDGA hali ketmagan.
  //
  // MUHIM: ilgari bu yerda `!exported` turardi, ya'ni ZIP paketi olingan ish «Tayyor»dan
  // chiqib ketardi va sudga yuborishga umuman taklif qilinmasdi. Eski dunyoda bu to'g'ri
  // edi — ZIP olish «ish operatorga topshirildi» degani edi. Endi esa sudga yuborish
  // ALOHIDA, haqiqiy amal: ZIP olish shunchaki fayl yuklab olish, sudga hech narsa
  // ketmaydi. 2026-09-07: BRIGHT'ning 100 ta ishi ZIP olingani uchun «Tayyor»dan
  // yo'qolgan edi, holbuki ularning bittasi ham sudga bermagan.
  // NAVBATDAGI ish «Tayyor» EMAS: u allaqachon olingan, ustida ish ketyapti. Aks holda
  // operator 291 tadan 200 tasini navbatga bergach ham «Tayyor 291» ko'rardi va shu
  // 200 tani qayta-qayta yuborishga urinardi.
  const queued = queuedCaseIds?.has(c.id) ?? false;
  const sendable = ready && !submitted && !draft && !draftReady && !queued && !SENT_STAGES.has(c.stage);
  return { talabnoma, scan, oferta, receipt, boji, ready, exported, submitted, submittedExternal, draft, draftReady, queued, sendable };
}

/**
 * ADOLAT'da SHU FIRMA nomidan OCHIQ da'vosi bor mijozlar — ikki to'plam.
 *
 *   `portal` — portalda ochiq ishi bor hamma mijoz. Bu — qayta yuborishga TO'SIQ:
 *              bir odamga ikkinchi da'vo ochilishi qaytarib bo'lmaydigan xato.
 *   `manual` — shulardan BIZ yubormaganlari, ya'ni yurist portalda qo'lda kiritganlari.
 *              Faqat KO'RSATISH uchun («Sudda 147+4» dagi +4).
 *
 * QAYTARILGAN ISH TO'SIQ EMAS. `DECLINED` — sud ishni ko'rmasdan qaytargan; uni tuzatib
 * QAYTA yuborish kerak, bu tizimda alohida oqim ham bor («Suddan qaytganlar»). 2026-09-08
 * da to'siq shu farqni bilmasdi va yagona ta'siri BRIGHT'ning qaytarilgan 15 ta ishini
 * bloklash bo'ldi — ya'ni aynan teskarisi.
 *
 * Qolgan holatlar (CREATED/ALLOCATE/REGISTER/PENDING/DECIDED/FINISHED) to'sadi: ish
 * sudda ko'rilyapti yoki allaqachon hal bo'lgan — ikkalasida ham ikkinchi da'vo noto'g'ri.
 *
 * MOSLIK FAQAT ANIQ: `matchedBy = 'PINFL'` — detal so'rovidan olingan javobgar PINFL'i
 * portfelimizdagi mijozga to'g'ri kelgani. Ism bo'yicha taxmin ATAYIN hisobga olinmaydi
 * (operator qarori): noto'g'ri taxmin haqiqiy qarzdorni konveyerdan jimgina chiqarardi.
 */
// Portalda AYNI PAYTDA ochiq/faol da'vo bosqichlari. DECIDED/FINISHED (hal bo'lgan) va
// DECLINED (qaytgan) ATAYIN yo'q: mijozning o'tgan yilgi tugagan ishi uning JORIY qarzi
// berilganini bildirmaydi (2026-09-08 «Sudda 19+286» bug'i shundan edi).
const OPEN_PORTAL_STATUSES = ['ALLOCATE', 'CREATED', 'REGISTER', 'PENDING', 'IN_PROCESS'];

/**
 * «Sudda N+M» dagi M — YURIST QO'LDA KIRITGAN da'volar: portalda shu firma nomidan OCHIQ
 * FAOL sud ishi bor mijozlar, LEKIN biz (hech qanday snapshotda) yubormaganmiz.
 *
 * Nega «biz yubormagan»ni PINFL bo'yicha, HAR QANDAY snapshotda tekshiramiz: yangi portfel
 * yuklanганда o'sha odamga yangi ArizaCase yaraladi (courtCaseId'siz), lekin biz uni oldingi
 * snapshotда yuborgan bo'lishimiz mumkin. Aks holda o'z eski yuborishlarimiz «tashqi» bo'lib
 * sanalardi (2026-09-08: URBAN'da 201 ta shunday «yolg'on tashqi» chiqqan edi).
 */
async function portalCasePinfls(firmId: number, branchCode: string | null, firmStir?: string | null): Promise<{ portal: Set<string>; manual: Set<string> }> {
  const empty = { portal: new Set<string>(), manual: new Set<string>() };
  if (!branchCode) return empty;
  const openRows = await prisma.clientCaseStatus.findMany({
    where: { source: 'CABINET', branchCode, matchedBy: 'PINFL', status: { in: OPEN_PORTAL_STATUSES }, pinfl: { not: null } },
    select: { pinfl: true },
  });
  if (!openRows.length) return empty;
  // BIZ YUBORGAN mijozlar (har qanday snapshot) — courtCaseId yoki yuborilgan bosqich.
  const ourSent = await prisma.arizaCase.findMany({
    where: { firmId, OR: [{ courtCaseId: { not: null } }, { stage: { in: [...SENT_STAGES] } }], pinfl: { not: null } },
    select: { pinfl: true },
  });
  const ourSentPinfls = new Set(ourSent.map((x) => x.pinfl).filter((p): p is string => !!p));
  const stir = (firmStir || '').replace(/\D/g, '');
  const manual = new Set<string>();
  for (const r of openRows) {
    if (!r.pinfl) continue;
    if (stir && r.pinfl === stir) continue;        // firma o'zi (da'vogar) — javobgar emas
    if (ourSentPinfls.has(r.pinfl)) continue;      // biz yuborganmiz — «tashqi» emas
    manual.add(r.pinfl);
  }
  return { portal: manual, manual };
}

// Case'ga biriktirilgan CaseDocument'lar to'plami (kind bo'yicha) — SKAN (SIGNED_ARIZA) va
// CHECK (TALABNOMA_RECEIPT) tayyorligini SHU case bo'yicha aniqlaydi (paket bilan bir manba).
async function caseIdSetByKind(caseIds: number[], kind: string): Promise<Set<number>> {
  if (caseIds.length === 0) return new Set();
  const docs = await prisma.caseDocument.findMany({ where: { caseId: { in: caseIds }, kind }, select: { caseId: true } });
  return new Set(docs.map((d) => d.caseId));
}
const signedCaseIdSet = (caseIds: number[]) => caseIdSetByKind(caseIds, 'SIGNED_ARIZA');

/**
 * NAVBATDA turgan (hali sudga yetib bormagan) case'lar — CourtQueueItem PENDING/RUNNING.
 *
 * Bu YAGONA manba: firma raqamlari, mijoz ro'yxati, sud taqsimoti va partiya tanlovi
 * ham shundan oziqlanadi, shuning uchun ular hech qachon bir-biriga zid bo'lmaydi.
 */
/**
 * Firma bo'yicha navbatda turgan ishlar SONI — navbat panelidagi bilan AYNAN bir manba.
 *
 * NEGA ALOHIDA: `queuedCaseIdSet` faqat SHU SNAPSHOT case'lari bo'yicha ishlaydi (u
 * qatordagi «Navbatda» belgisi uchun kerak). Firma qatoridagi SON esa navbat paneli bilan
 * yonma-yon turadi va panel snapshotni umuman bilmaydi — natijada bir ekranda «Navbatda
 * 200» va «195 navbatda» ko'rinardi (2026-09-08 kod ko'rigi). Endi ikkala son bitta
 * so'rovdan: firmaning PENDING+RUNNING yozuvlari.
 */
async function queuedCountForFirm(firmId: number): Promise<number> {
  return prisma.courtQueueItem.count({ where: { firmId, state: { in: ['PENDING', 'RUNNING'] } } });
}

async function queuedCaseIdSet(caseIds: number[]): Promise<Set<number>> {
  if (caseIds.length === 0) return new Set();
  const rows = await prisma.courtQueueItem.findMany({
    where: { caseId: { in: caseIds }, state: { in: ['PENDING', 'RUNNING'] } },
    select: { caseId: true },
  });
  return new Set(rows.map((r) => r.caseId));
}

// TO'LANGAN kvitansiya raqamlari to'plami.
//
// NEGA KERAK: portal `save-suit` dan oldin kvitansiyani tekshiradi va TO'LANMAGANI uchun
// «invoiceStatus is not valid» (400) qaytaradi — da'vo umuman ketmaydi. Ilgari `boji`
// sharti faqat RAQAM borligini tekshirardi, shuning uchun to'lanmagan kvitansiyali ish ham
// «Tayyor» ko'rinardi va partiyaga tushib, portalda yiqilardi. 2026-09-07 holati: raqami
// bor 3602 ta ishning 329 tasida kvitansiya CREATED (to'lanmagan).
//
// EKSPORT: shu manbadan sudga yuborish dvigateli (court-submit-job) va avtomat davom
// ettiruvchi (court-auto-resume) ham foydalanadi. Ilgari har biri o'z so'rovini yozgandi —
// «to'langan» ta'rifi uch joyda ayri-ayri turardi va biri o'zgarsa qolgani eskirib qolardi.
/**
 * Boji to'lanmagani uchun navbatdan o'tkazib yuborilgan ishga yoziladigan SABAB.
 *
 * Bitta joyda turadi, chunki uni ikki modul yozadi (partiya dvigateli va avtomat davom
 * ettiruvchi) va operator ikkalasida ham AYNAN bir xil matnni ko'rishi kerak — aks holda
 * bitta holat ikki xil nom bilan ko'rinadi.
 */
export const unpaidQueueReason = (receiptNumber: string | null): string =>
  receiptNumber
    ? `Davlat boji to'lanmagan (kvitansiya ${receiptNumber}). Buxgalteriyaga to'lovga bering — to'langach ish o'zi navbatga qaytadi.`
    : "Davlat boji kvitansiyasi (invoice raqami) yo'q. Avval invoice yarating.";

export async function paidReceiptSet(numbers: string[]): Promise<Set<string>> {
  const uniq = [...new Set(numbers.filter(Boolean))];
  if (!uniq.length) return new Set();
  const rows = await prisma.billingCheckInvoice.findMany({
    where: { number: { in: uniq }, invoiceStatus: 'PAID' },
    select: { number: true },
  });
  return new Set(rows.map((r) => r.number));
}
const receiptCaseIdSet = (caseIds: number[]) => caseIdSetByKind(caseIds, 'TALABNOMA_RECEIPT');

// Talabnoma xat.hippo'da YETKAZILGAN (kvitansiya/check bor) mijozlar PINFL to'plami.
// ClientCaseStatus (source HIPPO, category 'talabnoma') hippo SYNC'da to'ladi; delivered
// bucketни mail-status mapping aniqlaydi. Ism bo'yicha mos — shuning uchun bu KO'RSATKICH
// (hard-gate emas): «Tayyor»ni bloklamaydi, faqat yetkazilganini ko'rsatadi.
async function talabnomaDeliveredPinflSet(branchCode: string | null): Promise<Set<string>> {
  if (!branchCode) return new Set();
  const rows = await prisma.clientCaseStatus.findMany({
    where: { source: 'HIPPO', category: 'talabnoma', branchCode, pinfl: { not: null } },
    select: { pinfl: true, status: true },
  });
  const set = new Set<string>();
  for (const r of rows) if (r.pinfl && performLabel(r.status).bucket === 'delivered') set.add(r.pinfl);
  return set;
}

// Firma portfelida oferta chiqariladigan (summKr>0) mijozlar PINFL to'plami.
async function ofertaPinflSet(snapshotId: number | undefined, firmCode: string | null): Promise<Set<string>> {
  if (!firmCode) return new Set();
  const loans = await prisma.loan.findMany({
    where: { ...(snapshotId ? { snapshotId } : {}), branchCode: firmCode, summKr: { gt: 0 }, pinfl: { not: null } },
    select: { pinfl: true },
    distinct: ['pinfl'],
  });
  return new Set(loans.map((l) => l.pinfl).filter((p): p is string => !!p));
}

// «almost» = cases missing EXACTLY ONE of the 4 gate docs, split by which one — i.e. one step from
// court-ready. The court/boji panels highlight these so the operator finishes the near-ready clients
// first (e.g. «N mijoz faqat boji yetmaydi»).
export interface DocQuad { talabnoma: number; scan: number; oferta: number; receipt: number; boji: number }
// Firma sud paketiga qo'shiladigan Sanoat-palatasi hujjatlari — 3 tasi ham MAJBURIY.
// Biror yetishmasa firma sudga yubora olmaydi (paket chala ketmasin).
export const FIRM_REQUIRED_DOCS = ['GUVOHNOMA', 'ISHONCHNOMA', 'SHARTNOMA'] as const;
export const FIRM_DOC_LABEL: Record<string, string> = { GUVOHNOMA: 'guvohnoma', ISHONCHNOMA: 'ishonchnoma', SHARTNOMA: 'shartnoma' };
export interface FirmDocsStatus { complete: boolean; missing: string[]; present: string[] }
export interface FirmReadiness {
  firmId: number;
  firmName: string;
  total: number;
  ready: number;
  exported: number;   // ZIP chiqarilgan yoki sudga ketgan (umumiy «ishlov ko'rgan»)
  submitted: number;  // SUDGA haqiqatan yuborilgan — «Chiqarilgan» bilan aralashmasin
  /** `submitted` ichidan — ADOLAT'da yurist QO'LDA kiritgani (biz yubormaganmiz). */
  submittedExternal: number;
  draft: number;
  /** ADOLAT'da to'liq qoralama TAYYORLANGAN — yurist portalda o'zi yuboradi. */
  draftReady: number;
  /** Partiyaga olingan, hali sudga yetib bormagan (CourtQueueItem PENDING/RUNNING). */
  queued: number;
  sendable: number;
  missing: DocQuad;
  almost: DocQuad; // missing exactly this one doc (1 qadam qolgan)
  docs: FirmDocsStatus; // firma hujjatlari (guvohnoma/ishonchnoma/shartnoma) to'liqmi
}
/** Sud kesimida tally — panel «Sud bo'yicha» bo'limi shundan oziqlanadi (firma tallilari bilan
 *  BIR XIL flagsFor'dan, shuning uchun panel va asosiy sahifa hech qachon zid bo'lmaydi). */
export interface CourtTally { courtId: number; total: number; ready: number; submitted: number; draftReady: number; sendable: number; queued: number }

export interface CourtReadiness {
  firms: FirmReadiness[];
  courts: CourtTally[];
  overall: { total: number; ready: number; exported: number; submitted: number; submittedExternal: number; draft: number; draftReady: number; queued: number; sendable: number; missing: DocQuad; almost: DocQuad };
}

/** Per-firm «sudga tayyorlik»: jami / to'liq tayyor / chiqarilgan / yuborishga
 *  tayyor + qaysi hujjat yetishmayotgani (missing breakdown). */
export async function courtReadiness(snapshotId?: number, firmId?: number): Promise<CourtReadiness> {
  const firms = await prisma.firm.findMany({
    where: firmId ? { id: firmId } : {},
    select: { id: true, code: true, shortName: true, stir: true },
  });

  // Firma hujjatlari (guvohnoma/ishonchnoma/shartnoma) — bir so'rovda hammasi.
  const firmDocRows = await prisma.firmDocument.findMany({ where: { firmId: { in: firms.map((f) => f.id) } }, select: { firmId: true, kind: true } });
  const docKindsByFirm = new Map<number, Set<string>>();
  for (const d of firmDocRows) { const s = docKindsByFirm.get(d.firmId) ?? new Set(); s.add(String(d.kind)); docKindsByFirm.set(d.firmId, s); }
  const firmDocsStatus = (fid: number): FirmDocsStatus => {
    const have = docKindsByFirm.get(fid) ?? new Set<string>();
    const missing = FIRM_REQUIRED_DOCS.filter((k) => !have.has(k));
    return { complete: missing.length === 0, missing: missing.map((k) => FIRM_DOC_LABEL[k] ?? k), present: FIRM_REQUIRED_DOCS.filter((k) => have.has(k)).map((k) => FIRM_DOC_LABEL[k] ?? k) };
  };

  // Firms in parallel (was sequential — N round-trips of case-scan + oferta-scan on the
  // aggregate «Hamma firma» load). Each firm's two queries already run together.
  const perFirm = await Promise.all(firms.map(async (f): Promise<{ fr: FirmReadiness; courts: Map<number, CourtTally> } | null> => {
    const [cases, ofertaPinfls] = await Promise.all([
      prisma.arizaCase.findMany({
        where: { firmId: f.id, ...(snapshotId ? { snapshotId } : {}) },
        select: { id: true, pinfl: true, stage: true, talabnomaAt: true, receiptNumber: true, courtCaseId: true, courtId: true, meta: true },
        orderBy: { id: 'asc' },
      }),
      ofertaPinflSet(snapshotId, f.code),
    ]);
    if (cases.length === 0) return null;
    // Beshovi BIR VAQTDA: ular bir-biriga bog'liq emas. Ketma-ket bo'lganda 9 firma uchun
    // 45 ta navbatdagi so'rov chiqardi va bu operator partiya ketayotganda qayta-qayta
    // yangilaydigan sahifa.
    const ids = cases.map((c) => c.id);
    const [signedIds, receiptIds, paidReceipts, queuedIds, portalCases] = await Promise.all([
      signedCaseIdSet(ids),
      receiptCaseIdSet(ids),
      paidReceiptSet(cases.map((c) => c.receiptNumber ?? '').filter(Boolean) as string[]),
      queuedCaseIdSet(ids),
      portalCasePinfls(f.id, f.code, f.stir),
    ]);
    const queuedTotal = await queuedCountForFirm(f.id);

    const fr: FirmReadiness = {
      firmId: f.id, firmName: f.shortName, total: cases.length,
      ready: 0, exported: 0, submitted: 0, submittedExternal: 0, draft: 0, draftReady: 0, queued: 0, sendable: 0,
      missing: { talabnoma: 0, scan: 0, oferta: 0, receipt: 0, boji: 0 },
      almost: { talabnoma: 0, scan: 0, oferta: 0, receipt: 0, boji: 0 },
      docs: firmDocsStatus(f.id),
    };
    // Sud kesimidagi tally — AYNI flagsFor natijasidan (panel bilan bitta haqiqat).
    const courtMap = new Map<number, CourtTally>();
    for (const c of cases as CaseRow[]) {
      const fl = flagsFor(c, signedIds, receiptIds, ofertaPinfls, paidReceipts, queuedIds, portalCases);
      if (fl.ready) fr.ready++;
      if (fl.exported) fr.exported++;
      if (fl.submitted) fr.submitted++;
      if (fl.submittedExternal) fr.submittedExternal++;
      if (fl.draft) fr.draft++;
      if (fl.draftReady) fr.draftReady++;
      if (fl.sendable) fr.sendable++;
      if (c.courtId != null) {
        const ct = courtMap.get(c.courtId) ?? { courtId: c.courtId, total: 0, ready: 0, submitted: 0, draftReady: 0, sendable: 0, queued: 0 };
        ct.total++;
        if (fl.ready) ct.ready++;
        if (fl.submitted) ct.submitted++;
        if (fl.draftReady) ct.draftReady++;
        if (fl.sendable) ct.sendable++;
        if (fl.queued) ct.queued++;
        courtMap.set(c.courtId, ct);
      }
      if (!fl.talabnoma) fr.missing.talabnoma++;
      if (!fl.scan) fr.missing.scan++;
      if (!fl.oferta) fr.missing.oferta++;
      if (!fl.receipt) fr.missing.receipt++;
      if (!fl.boji) fr.missing.boji++;
      // «1 qadam qolgan» — gate'ning 5 shartidan AYNAN bittasi yetishmaydi (talabnoma/skan/
      // oferta/check/boji). Barchasi endi majburiy gate, shuning uchun beshovi ham hisobga olinadi.
      const gaps = (fl.talabnoma ? 0 : 1) + (fl.scan ? 0 : 1) + (fl.oferta ? 0 : 1) + (fl.receipt ? 0 : 1) + (fl.boji ? 0 : 1);
      if (gaps === 1 && !fl.exported && !SENT_STAGES.has(c.stage)) {
        if (!fl.talabnoma) fr.almost.talabnoma++;
        else if (!fl.scan) fr.almost.scan++;
        else if (!fl.oferta) fr.almost.oferta++;
        else if (!fl.receipt) fr.almost.receipt++;
        else fr.almost.boji++;
      }
    }
    // «Navbatda» — panel bilan bitta manbadan (yuqoridagi `queuedCountForFirm` izohiga q.).
    fr.queued = queuedTotal;
    return { fr, courts: courtMap };
  }));
  const nonNull = perFirm.filter((x): x is { fr: FirmReadiness; courts: Map<number, CourtTally> } => x !== null);
  const firmsOut = nonNull.map((x) => x.fr);
  firmsOut.sort((a, b) => b.total - a.total);

  // Firmalar bo'yicha sud tallilarini yig'amiz (bir sud bir necha firmadan iborat bo'lishi mumkin).
  const courtAgg = new Map<number, CourtTally>();
  for (const { courts } of nonNull) {
    for (const [cid, ct] of courts) {
      const acc = courtAgg.get(cid) ?? { courtId: cid, total: 0, ready: 0, submitted: 0, draftReady: 0, sendable: 0, queued: 0 };
      acc.total += ct.total; acc.ready += ct.ready; acc.submitted += ct.submitted;
      acc.draftReady += ct.draftReady; acc.sendable += ct.sendable; acc.queued += ct.queued;
      courtAgg.set(cid, acc);
    }
  }
  const courtsOut = [...courtAgg.values()].sort((a, b) => b.total - a.total);

  const overall = firmsOut.reduce(
    (o, f) => {
      o.total += f.total; o.ready += f.ready; o.exported += f.exported; o.submitted += f.submitted; o.submittedExternal += f.submittedExternal; o.draft += f.draft; o.draftReady += f.draftReady; o.queued += f.queued; o.sendable += f.sendable;
      o.missing.talabnoma += f.missing.talabnoma; o.missing.scan += f.missing.scan;
      o.missing.oferta += f.missing.oferta; o.missing.receipt += f.missing.receipt; o.missing.boji += f.missing.boji;
      o.almost.talabnoma += f.almost.talabnoma; o.almost.scan += f.almost.scan;
      o.almost.oferta += f.almost.oferta; o.almost.receipt += f.almost.receipt; o.almost.boji += f.almost.boji;
      return o;
    },
    { total: 0, ready: 0, exported: 0, submitted: 0, submittedExternal: 0, draft: 0, draftReady: 0, queued: 0, sendable: 0, missing: { talabnoma: 0, scan: 0, oferta: 0, receipt: 0, boji: 0 }, almost: { talabnoma: 0, scan: 0, oferta: 0, receipt: 0, boji: 0 } },
  );

  return { firms: firmsOut, courts: courtsOut, overall };
}

// ── Per-client (case-level) drill-down: the 4-doc checklist, filterable ───────
export type ReadyFilter = 'all' | 'sendable' | 'queued' | 'draft' | 'ready' | 'exported' | 'submitted' | 'notready';
export interface ClientReadyRow {
  caseId: number;
  clientName: string | null;
  pinfl: string | null;
  stage: CaseStage;
  stageLabel: string;
  talabnoma: boolean;
  talabnomaDelivered: boolean; // xat.hippo'da YETKAZILGAN (indicator)
  receipt: boolean;            // talabnoma «check» (TALABNOMA_RECEIPT) biriktirilgan — MAJBURIY gate
  scan: boolean;
  oferta: boolean;
  boji: boolean;
  ready: boolean;
  exported: boolean;
  /** SUDGA haqiqatan topshirilgan — «Chiqarilgan» (ZIP) bilan aralashmasin. */
  submitted: boolean;
  /**
   * `submitted` sababi BIZ EMAS: ADOLAT'da shu odamga bu firma nomidan TIRIK da'vo bor
   * (yurist portalda qo'lda kiritgan). Qatorda alohida ko'rsatiladi — busiz mijoz
   * «Tayyor»dan sababsiz yo'qolgandek tuyulardi va operator uni qidirib yurardi.
   */
  submittedExternal: boolean;
  draft: boolean;
  draftReady: boolean;
  /** Partiyaga olingan, hali sudga yetib bormagan — «Tayyor»dan chiqarilgan. */
  queued: boolean;
  /** Ish qaysi sudga yo'naltirilgan (filtr uchun; tayinlanmagan bo'lsa null). */
  courtId: number | null;
  courtName: string | null;
  /** Sud ADOLAT orqali elektron ariza qabul qiladimi. */
  courtEnabled: boolean;
  sendable: boolean;
  totalDebt: string;
  daysLeft: number | null;
  receiptNumber: string | null; // real boji kvitansiya № (for the drill-down CaseDocs invoice slot)
}
export type { ClientReadyCounts };
export interface ClientReadyPage {
  rows: ClientReadyRow[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
  counts: ClientReadyCounts;
}

/** Per-client readiness rows for ONE firm — the 4-doc checklist per case, filterable
 *  (all/sendable/ready/exported/notready), searchable (name/PINFL), paged. Counts are
 *  computed over the search-filtered set so the filter chips stay honest. */
export async function firmReadyClients(opts: {
  snapshotId?: number; firmId: number;
}): Promise<ClientReadyPage> {
  const empty: ClientReadyPage = { rows: [], total: 0, page: 1, pageSize: 0, pages: 1, counts: emptyClientCounts() };

  const firm = await prisma.firm.findUnique({ where: { id: opts.firmId }, select: { id: true, code: true, stir: true } });
  if (!firm) return empty;
  const [cases, ofertaPinfls] = await Promise.all([
    prisma.arizaCase.findMany({
      where: { firmId: firm.id, ...(opts.snapshotId ? { snapshotId: opts.snapshotId } : {}) },
      select: {
        id: true, pinfl: true, clientName: true, stage: true, talabnomaAt: true, receiptNumber: true,
        meta: true, totalDebt: true, dueAt: true,
        // Sud — «Batafsil» ro'yxatida filtr uchun. Firmaning ishlari bir necha sudga
        // bo'lingan bo'lishi mumkin (BRIGHT: Yuqorichirchiq + Uchtepa) va ulardan biri
        // ADOLAT'da yopiq bo'lsa, operator ochiq sudnikini ajratib yubora olishi kerak.
        courtId: true,
        court: { select: { shortName: true, cabinetEnabled: true } },
      },
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
    }),
    ofertaPinflSet(opts.snapshotId, firm.code),
  ]);
  const ids = cases.map((c) => c.id);
  const [signedIds, receiptIds, paidReceipts, queuedIds, portalCases] = await Promise.all([
    signedCaseIdSet(ids),
    receiptCaseIdSet(ids),
    paidReceiptSet(cases.map((c) => c.receiptNumber ?? '').filter(Boolean) as string[]),
    queuedCaseIdSet(ids),
    portalCasePinfls(firm.id, firm.code, firm.stir),
  ]);
  const deliveredPinfls = await talabnomaDeliveredPinflSet(firm.code);
  const now = Date.now();
  const day = 86400000;

  // ALL rows + counts in ONE query — the drill-down filters/searches/paginates client-side, so a
  // filter or page switch never re-hits the DB. That per-interaction refetch (each loading the whole
  // firm's cases + meta) was the «juda sekin»; now the firm is loaded once when the drill-down opens.
  const rows: ClientReadyRow[] = [];
  for (const c of cases) {
    const fl = flagsFor(c as CaseRow, signedIds, receiptIds, ofertaPinfls, paidReceipts, queuedIds, portalCases);
    rows.push({
      caseId: c.id, clientName: c.clientName, pinfl: c.pinfl, stage: c.stage, stageLabel: STAGE_LABEL[c.stage],
      talabnoma: fl.talabnoma, talabnomaDelivered: !!(c.pinfl && deliveredPinfls.has(c.pinfl)),
      receipt: fl.receipt, scan: fl.scan, oferta: fl.oferta, boji: fl.boji,
      ready: fl.ready, exported: fl.exported, submitted: fl.submitted, submittedExternal: fl.submittedExternal, draft: fl.draft, draftReady: fl.draftReady, queued: fl.queued, sendable: fl.sendable,
      totalDebt: String(c.totalDebt),
      daysLeft: c.dueAt ? ((v: number) => (v < 0 ? Math.floor(v) : Math.ceil(v)))((c.dueAt.getTime() - now) / day) : null,
      receiptNumber: c.receiptNumber,
      courtId: c.courtId ?? null,
      courtName: c.court?.shortName ?? null,
      courtEnabled: c.court ? c.court.cabinetEnabled !== false : true,
    });
  }
  return { rows, total: rows.length, page: 1, pageSize: rows.length, pages: 1, counts: tallyClientCounts(rows) };
}

/** Yuborishga TAYYOR (sendable) case'larni SUD bo'yicha guruhlaydi — «Sudga yuborish»
 *  modalida qaysi sudga nechta ketishini ko'rsatish uchun (faqat ko'rsatkich; yuborish
 *  baribir firma bo'yicha). Gate flagsFor bilan bir xil (25.08/aktiv snapshot). */
export interface CourtBreakdownItem {
  courtId: number | null;
  shortName: string;
  count: number;
  /** Sud ADOLAT orqali elektron ariza qabul qiladimi (Court.cabinetEnabled). */
  enabled: boolean;
  /** Yopiq bo'lsa — sababi (operatorga ko'rsatiladi). */
  note: string | null;
}
export async function sendableCourtBreakdown(opts: { snapshotId?: number; firmId: number }): Promise<{ courts: CourtBreakdownItem[]; total: number }> {
  const firm = await prisma.firm.findUnique({ where: { id: opts.firmId }, select: { id: true, code: true, stir: true } });
  if (!firm) return { courts: [], total: 0 };
  const [cases, ofertaPinfls] = await Promise.all([
    prisma.arizaCase.findMany({
      where: { firmId: firm.id, ...(opts.snapshotId ? { snapshotId: opts.snapshotId } : {}) },
      select: { id: true, pinfl: true, stage: true, talabnomaAt: true, receiptNumber: true, courtCaseId: true, meta: true, courtId: true, court: { select: { shortName: true } } },
    }),
    ofertaPinflSet(opts.snapshotId, firm.code),
  ]);
  const ids = cases.map((c) => c.id);
  const [signedIds, receiptIds, paidReceipts, queuedIds, portalCases] = await Promise.all([
    signedCaseIdSet(ids),
    receiptCaseIdSet(ids),
    paidReceiptSet(cases.map((c) => c.receiptNumber ?? '').filter(Boolean) as string[]),
    queuedCaseIdSet(ids),
    portalCasePinfls(firm.id, firm.code, firm.stir),
  ]);

  // BARCHA faol sudlar ro'yxatdan boshlanadi — tayyor ishi bo'lmagani ham, ADOLAT'da yopig'i
  // ham ko'rinsin. Avval faqat ishi borlari chiqardi va operator yopiq sudni umuman ko'rmasdi:
  // «nega bu ishlar ketmayapti?» degan savol javobsiz qolardi.
  const allCourts = await prisma.court.findMany({
    where: { active: true },
    select: { id: true, shortName: true, cabinetEnabled: true, cabinetNote: true, sortOrder: true },
    orderBy: { sortOrder: 'asc' },
  });
  const byCourt = new Map<string, CourtBreakdownItem>();
  for (const c of allCourts) {
    byCourt.set(String(c.id), {
      courtId: c.id, shortName: c.shortName, count: 0,
      enabled: c.cabinetEnabled, note: c.cabinetNote ?? null,
    });
  }

  let total = 0;
  for (const c of cases) {
    const fl = flagsFor(c as CaseRow, signedIds, receiptIds, ofertaPinfls, paidReceipts, queuedIds, portalCases);
    if (!fl.sendable) continue;
    total++;
    const key = String(c.courtId ?? 'none');
    const item = byCourt.get(key) ?? {
      courtId: c.courtId ?? null,
      shortName: c.court?.shortName ?? 'Sud tayinlanmagan',
      count: 0, enabled: true, note: null,
    };
    item.count++;
    byCourt.set(key, item);
  }
  // Ishi borlari tepada; yopiq sudlar pastda (lekin ko'rinadi).
  const courts = [...byCourt.values()].sort((a, b) =>
    Number(b.enabled) - Number(a.enabled) || b.count - a.count,
  );
  return { courts, total };
}

/** Yuborishga TAYYOR case id'lari (kartadagi «Tayyor» bilan AYNAN bir xil shart —
 *  flagsFor().sendable), firma bo'yicha, eng eski muddatdan (dueAt) boshlab, `limit` tagacha.
 *
 *  DIQQAT — KURSOR/OFFSET YO'Q: `limit` berilganda ro'yxat HAR SAFAR boshidan olinadi, ya'ni
 *  bu «eng eski N ta» amali, «keyingi N ta» EMAS. ZIP oqimida buni sezish oson: ZIP hech
 *  narsani band qilmaydi va `sendable`ni o'zgartirmaydi, shuning uchun 616 tadan 100 tasini
 *  ZIP qilib tugmani yana bossangiz — AYNI o'sha 100 ta chiqadi. Qolganini olish yo'li:
 *  «Hammasi (N)» ni so'rash yoki «Batafsil»da qo'lda belgilash (validateSelectedCaseIds).
 *  Sudga yuborish oqimida esa olingan ishlar NAVBATga tushadi va shu bilan `sendable`dan
 *  chiqadi — u yerda keyingi bosish haqiqatan keyingi N ta ishni beradi.
 *
 *  `includeExported` / `forExport` chaqiruvchilar bilan moslik uchun qabul qilinadi, LEKIN
 *  tanlovga ta'sir qilmaydi: «allaqachon chiqarilgan» filtri 2026-09-07 da butunlay olib
 *  tashlangan (operator qarori). */
export async function selectReadyCaseIds(opts: {
  snapshotId?: number; firmId: number; limit: number; includeExported?: boolean; forExport?: boolean;
}): Promise<number[]> {
  const firm = await prisma.firm.findUnique({ where: { id: opts.firmId }, select: { id: true, code: true, stir: true } });
  if (!firm) return [];
  const [cases, ofertaPinfls] = await Promise.all([
    prisma.arizaCase.findMany({
      where: { firmId: firm.id, ...(opts.snapshotId ? { snapshotId: opts.snapshotId } : {}) },
      select: { id: true, pinfl: true, stage: true, talabnomaAt: true, receiptNumber: true, courtCaseId: true, meta: true },
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
    }),
    ofertaPinflSet(opts.snapshotId, firm.code),
  ]);
  const ids = cases.map((c) => c.id);
  const [signedIds, receiptIds, paidReceipts, queuedIds, portalCases] = await Promise.all([
    signedCaseIdSet(ids),
    receiptCaseIdSet(ids),
    paidReceiptSet(cases.map((c) => c.receiptNumber ?? '').filter(Boolean) as string[]),
    queuedCaseIdSet(ids),
    portalCasePinfls(firm.id, firm.code, firm.stir),
  ]);
  const picked: number[] = [];
  for (const c of cases as CaseRow[]) {
    const fl = flagsFor(c, signedIds, receiptIds, ofertaPinfls, paidReceipts, queuedIds, portalCases);
    // Shart AYNAN kartadagi «Tayyor» bilan bir xil (fl.sendable) — bitta manba, flagsFor.
    //
    // 2026-09-08: bu yerda `ready && !SENT_STAGES` turardi, karta va modal esa `sendable`
    // (ready VA sudda/qoralama/NAVBATDA emas) bo'yicha sanardi. Ikki to'plam bir xil emas
    // edi: operator «Tayyor 616» ni ko'rib 616 tani so'raganda tanlovga ALLAQACHON navbatda
    // turgan ishlar ham tushardi — bitta ish ikkinchi marta partiyaga olinardi va karta /
    // modal / partiya uch xil raqam ko'rsatardi.
    // ZIP olingani (meta.exportedAt) baribir to'siq EMAS: `sendable` uni tekshirmaydi. ZIP
    // sudga hech narsa yubormaydi, shunchaki fayl yuklab olish — shuning uchun «allaqachon
    // chiqarilgan» filtri 2026-09-07 da butunlay olib tashlangan (operator qarori).
    if (!fl.sendable) continue;
    picked.push(c.id);
    if (picked.length >= opts.limit) break;
  }
  return picked;
}

/** Foydalanuvchi qo'lda tanlagan case id'larni SERVER tomonda qayta tekshirish —
 *  faqat o'sha firmaga tegishli, to'liq tayyor, sudga chiqmagan (va includeExported
 *  bo'lmasa chiqarilmagan) bo'lganlari qaytadi. Eskirgan tanlov ZIP'ga nomos case
 *  «olib kira» olmaydi (client filtri hech qachon avtorizatsiya sifatida ishonilmaydi). */
export async function validateSelectedCaseIds(opts: {
  snapshotId?: number; firmId: number; caseIds: number[]; includeExported?: boolean; forExport?: boolean; limit?: number;
}): Promise<number[]> {
  const firm = await prisma.firm.findUnique({ where: { id: opts.firmId }, select: { id: true, code: true, stir: true } });
  if (!firm || !opts.caseIds.length) return [];
  const [cases, ofertaPinfls] = await Promise.all([
    prisma.arizaCase.findMany({
      where: { id: { in: opts.caseIds }, firmId: firm.id, ...(opts.snapshotId ? { snapshotId: opts.snapshotId } : {}) },
      select: { id: true, pinfl: true, stage: true, talabnomaAt: true, receiptNumber: true, courtCaseId: true, meta: true },
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
    }),
    ofertaPinflSet(opts.snapshotId, firm.code),
  ]);
  const ids = cases.map((c) => c.id);
  const [signedIds, receiptIds, paidReceipts, queuedIds, portalCases] = await Promise.all([
    signedCaseIdSet(ids),
    receiptCaseIdSet(ids),
    paidReceiptSet(cases.map((c) => c.receiptNumber ?? '').filter(Boolean) as string[]),
    queuedCaseIdSet(ids),
    portalCasePinfls(firm.id, firm.code, firm.stir),
  ]);
  return (cases as CaseRow[])
    .filter((c) => {
      const fl = flagsFor(c, signedIds, receiptIds, ofertaPinfls, paidReceipts, queuedIds, portalCases);
      // ZIP va SUDGA YUBORISH uchun shart ATAYIN boshqacha.
      //
      // Ilgari bu yerda `queuedIds`/`externalPinfls` hisoblanar, LEKIN ishlatilmasdi —
      // ya'ni qo'lda belgilangan ish navbatda tursa ham, portalda da'vosi bo'lsa ham
      // partiyaga tushaverardi. Bu — ikkinchi da'voga ochiq yagona yo'l edi, chunki
      // eskirgan tanlovni to'sish uchun mo'ljallangan server tekshiruvi aynan shu.
      //
      // ZIP boshqa masala: u sudga hech narsa yubormaydi, shuning uchun navbatda turgan
      // mijozning hujjatlarini yuklab olishni to'sish noto'g'ri bo'lardi. Lekin SUDGA
      // ketgan ish u yerda ham chiqarilmaydi.
      if (opts.forExport) return fl.ready && !fl.submitted && !SENT_STAGES.has(c.stage);
      return fl.sendable;
    })
    .map((c) => c.id)
    .slice(0, Math.min(MAX_COURT_BATCH, opts.limit ?? MAX_COURT_BATCH));
}

/** Chiqarilgan deb belgilash — ArizaCase.meta.exportedAt (JSON merge, schema
 *  o'zgarmaydi). Paket ZIP tayyor bo'lgach chaqiriladi. */
export async function markCasesExported(caseIds: number[]): Promise<void> {
  if (!caseIds.length) return;
  const rows = await prisma.arizaCase.findMany({ where: { id: { in: caseIds } }, select: { id: true, meta: true } });
  const now = new Date().toISOString();
  // Parallel (was N sequential round-trips). Each targets a distinct id and keeps the
  // per-row best-effort .catch; capped at ≤100 ids so pool pressure stays bounded.
  await Promise.all(rows.map((r) => {
    const base = r.meta && typeof r.meta === 'object' && !Array.isArray(r.meta) ? { ...(r.meta as Record<string, unknown>) } : {};
    base.exportedAt = now;
    return prisma.arizaCase.update({ where: { id: r.id }, data: { meta: base as never } }).catch(() => {});
  }));
}

/** «Bekor qilish» — clear the court send/draft marks (meta.exportedAt / meta.draftAt) so the cases
 *  return to «Tayyor». Undo of a real send OR a qoralama. Returns how many were actually reverted. */
export async function undoCaseState(caseIds: number[]): Promise<number> {
  if (!caseIds.length) return 0;
  // Sud kunlik limitini qaytaramiz — bekor qilingan yuborish quotani band qilib qolmasin.
  //
  // LEKIN: SUDGA HAQIQATAN ketgan ishga tegilmaydi. Ilgari shart yo'q edi va «Bekor qilish»
  // sudda turgan da'voning ham `courtSentAt` ini tozalab yuborardi — sud kunlik limiti
  // soxta bo'shab qolardi va o'sha kuni limitdan ORTIQ ariza yuborilishi mumkin edi
  // (2026-09-07 auditi). Sudga ketgani `stage` yoki `courtCaseId` bilan aniqlanadi.
  await prisma.arizaCase.updateMany({
    where: {
      id: { in: caseIds.slice(0, 200) },
      courtCaseId: null,
      stage: { notIn: ['COURT_SUBMITTED', 'COURT_ACCEPTED', 'MIB_SUBMITTED', 'CLOSED'] },
    },
    data: { courtSentAt: null },
  }).catch(() => {});
  const rows = await prisma.arizaCase.findMany({ where: { id: { in: caseIds.slice(0, 200) } }, select: { id: true, meta: true } });
  let reverted = 0;
  await Promise.all(rows.map((r) => {
    const base = r.meta && typeof r.meta === 'object' && !Array.isArray(r.meta) ? { ...(r.meta as Record<string, unknown>) } : {};
    if (!base.exportedAt && !base.draftAt) return Promise.resolve();
    delete base.exportedAt; delete base.draftAt;
    reverted++;
    return prisma.arizaCase.update({ where: { id: r.id }, data: { meta: base as never } }).catch(() => {});
  }));
  return reverted;
}

// ── Real status hisoboti (ClientCaseStatus — Adolat/hippo ingest) ────────────
// Two DIFFERENT axes: CABINET = sud (court) ish holati; HIPPO = talabnoma (pochta)
// yetkazish holati. Buckets carry `source` so the UI can segment (Sud / Talabnoma).
export interface StatusBucket { code: string; label: string; tone: string; count: number; source: string }
export interface CourtStatusBoard {
  total: number;
  matched: number;   // portfel mijoziga bog'langan (pinfl bor)
  buckets: StatusBucket[];
  sources: Record<string, number>; // CABINET / HIPPO
}

type Cls = { code: string; label: string; tone: string };
// CABINET court OUTCOME (caseResult is ENGLISH — the decisive result when present).
const CABINET_RESULT: Record<string, Cls> = {
  FULFILLED: { code: 'SATISFIED', label: 'Qanoatlantirilgan', tone: 'emerald' },
  RETURNED: { code: 'RETURNED', label: 'Qaytarilgan', tone: 'rose' },
  REFUSED: { code: 'DECLINED', label: 'Rad etilgan', tone: 'rose' },
  UNCONSIDERED: { code: 'UNCONSIDERED', label: 'Ko‘rilmasdan qoldirilgan', tone: 'slate' },
};
// CABINET process status (English) — when no decisive result yet.
const CABINET_STATUS: Record<string, Cls> = {
  DRAFT: { code: 'DRAFT', label: 'Qoralama', tone: 'slate' },
  CREATED: { code: 'CREATED', label: 'Kelgan (ro‘yxatda)', tone: 'sky' },
  PENDING: { code: 'PENDING', label: 'Kutilmoqda', tone: 'amber' },
  IN_PROCESS: { code: 'IN_PROCESS', label: 'Ko‘rilmoqda', tone: 'blue' },
  DECIDED: { code: 'DECIDED', label: 'Qaror chiqdi', tone: 'violet' },
  FINISHED: { code: 'FINISHED', label: 'Yakunlangan', tone: 'emerald' },
  DECLINED: { code: 'DECLINED', label: 'Rad etilgan', tone: 'rose' },
};
// HIPPO talabnoma POSTAL delivery outcome (the `status` field; caseResult="Success" is noise).
const HIPPO_STATUS: Record<string, Cls> = {
  SUCCESSDELIVERED: { code: 'DELIVERED', label: 'Yetkazildi', tone: 'emerald' },
  SUCCESS: { code: 'SENT', label: 'Yuborildi', tone: 'sky' },
  INCOMPLETEADDRESS: { code: 'ADDR', label: 'Manzil noto‘liq', tone: 'amber' },
  RECEIVERNOTLIVESTHERE: { code: 'NOTLIVE', label: 'Bu manzilda yashamaydi', tone: 'amber' },
  DIDNTAPPEARONNOTICE: { code: 'NOSHOW', label: 'Chaqiruvga kelmadi', tone: 'amber' },
  NOTATHOME: { code: 'NOTHOME', label: 'Uyda yo‘q', tone: 'amber' },
  RECEIVERREFUSE: { code: 'REFUSE', label: 'Qabul qilmadi', tone: 'rose' },
  RECEIVERDEAD: { code: 'DEAD', label: 'Qarzdor vafot etgan', tone: 'slate' },
};

// Source-aware so the same raw string never lands in the wrong vocabulary. Unknown
// codes still surface (Uzbek statusLabel for CABINET, «Boshqa» for HIPPO) — nothing dropped.
function classifyStatus(source: string, row: { status: string; statusLabel: string | null; caseResult: string | null }): Cls {
  const st = (row.status || '').trim();
  const stU = st.toUpperCase();
  if (source === 'CABINET') {
    const res = (row.caseResult || '').trim();
    const resU = res.toUpperCase();
    const resL = res.toLowerCase();
    if (resL.includes('qanoatlantir') && resL.includes('qisman')) return { code: 'PARTIAL', label: 'Qisman qanoatlantirilgan', tone: 'amber' };
    if (CABINET_RESULT[resU]) return CABINET_RESULT[resU]; // English outcome wins
    if (CABINET_STATUS[stU]) return CABINET_STATUS[stU];
    const lbl = row.statusLabel || st || 'Noma’lum'; // key by the localized label so dups merge
    return { code: `C_${lbl}`, label: lbl, tone: 'slate' };
  }
  // HIPPO delivery
  if (HIPPO_STATUS[stU]) return HIPPO_STATUS[stU];
  return { code: 'H_OTHER', label: 'Boshqa (yetkazish)', tone: 'slate' }; // numeric/unknown codes → one bucket
}

/** ClientCaseStatus'ni Uzbek toifalarga guruhlab, to'liq status hisoboti.
 *  Hech qaysi status tashlab ketilmaydi. */
export async function courtStatusBoard(snapshotId?: number, firmId?: number): Promise<CourtStatusBoard> {
  let branchCode: string | undefined;
  if (firmId) {
    const firm = await prisma.firm.findUnique({ where: { id: firmId }, select: { code: true } });
    branchCode = firm?.code ?? '__none__';
  }
  const where = { ...(branchCode ? { branchCode } : {}), ...(snapshotId ? { snapshotId } : {}) };
  // Group in the DB rather than loading every row: classifyStatus is a pure function of
  // (status, statusLabel, caseResult), so classifying each DISTINCT combo once and summing
  // its _count is identical to classifying every row — far less transfer + no big JS loop.
  const [grouped, matched] = await Promise.all([
    // Deterministic order so the representative label of an unmapped-status bucket (and the
    // left-right position of equal-count buckets) is stable across builds — counts are
    // identical either way; only which label variant "wins" for an ambiguous code was unstable.
    prisma.clientCaseStatus.groupBy({
      by: ['status', 'statusLabel', 'caseResult', 'source'],
      where,
      _count: { _all: true },
      orderBy: [{ status: 'asc' }, { statusLabel: 'asc' }, { caseResult: 'asc' }],
    }),
    prisma.clientCaseStatus.count({ where: { ...where, pinfl: { not: null } } }),
  ]);

  const byCode = new Map<string, StatusBucket>();
  const sources: Record<string, number> = {};
  let total = 0;
  for (const g of grouped) {
    const cnt = g._count._all;
    total += cnt;
    sources[g.source] = (sources[g.source] ?? 0) + cnt;
    const c = classifyStatus(g.source, g);
    // Key by source+code so a court bucket and a delivery bucket never merge, and the UI can segment.
    const key = `${g.source}:${c.code}`;
    const b = byCode.get(key) ?? { code: c.code, label: c.label, tone: c.tone, count: 0, source: g.source };
    b.count += cnt;
    byCode.set(key, b);
  }
  const buckets = [...byCode.values()].sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  return { total, matched, buckets, sources };
}

// ── Qaytganlar (to'ldirib qayta yuborish) ────────────────────────────────────
export interface ReturnCase {
  caseId: number;
  clientName: string | null;
  pinfl: string | null;
  firmId: number;
  firmName: string;
  stage: CaseStage;
  stageLabel: string;
  receiptNumber: string | null;
  talabnomaSent: boolean;
  totalDebt: string;
  daysLeft: number | null;
  docCount: number;
}

const RETURN_STAGES: CaseStage[] = ['COURT_RETURNED', 'CHAMBER_RETURNED'];

/** Qaytgan ishlar (sud qaytardi / palatadan qaytgan) — to'ldirib, belgilab,
 *  qayta yuborish uchun. */
export async function courtReturns(snapshotId?: number, firmId?: number): Promise<ReturnCase[]> {
  const rows = await prisma.arizaCase.findMany({
    where: { stage: { in: RETURN_STAGES }, ...(snapshotId ? { snapshotId } : {}), ...(firmId ? { firmId } : {}) },
    orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true, clientName: true, pinfl: true, firmId: true, stage: true, receiptNumber: true,
      talabnomaAt: true, totalDebt: true, dueAt: true,
      firm: { select: { shortName: true } },
      _count: { select: { documents: true } },
    },
  });
  const now = Date.now();
  const day = 86400000;
  return rows.map((r) => ({
    caseId: r.id,
    clientName: r.clientName,
    pinfl: r.pinfl,
    firmId: r.firmId,
    firmName: r.firm?.shortName ?? '',
    stage: r.stage,
    stageLabel: STAGE_LABEL[r.stage],
    receiptNumber: r.receiptNumber,
    talabnomaSent: !!r.talabnomaAt,
    totalDebt: String(r.totalDebt),
    daysLeft: r.dueAt ? ((v: number) => (v < 0 ? Math.floor(v) : Math.ceil(v)))((r.dueAt.getTime() - now) / day) : null,
    docCount: r._count.documents,
  }));
}

// Partiya hajmi alohida modulda (client ham ishlatadi — u yerda prisma bo'lmasligi kerak).
export { MAX_COURT_BATCH } from './court-batch';
