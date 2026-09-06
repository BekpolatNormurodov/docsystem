export interface FirmSeed {
  code: string;
  shortName: string;
  legalName?: string;
  address?: string;
  bankAccount?: string;
  mfo?: string;
  stir?: string;
  postIndex?: string;
  /** cabinet.sud.uz da'vogar GUID — da'vo shu firma nomidan ochiladi. FAQAT jonli tekshirilgan
   *  firma uchun yoziladi: seed `update` bilan ishlaydi, ya'ni bu yerda turgan qiymat har
   *  deploy'da ustiga yoziladi. Qolgan firmalar uchun ATAYIN bo'sh — ular qiymatni Firmalar
   *  bo'limidan kiritadi yoki tizim portaldan o'zi aniqlaydi (src/lib/cabinet/claimant.ts),
   *  va bu yerda kalit bo'lmagani uchun seed ularni tegmaydi. */
  cabinetClaimantId?: string;
}

// Latin addresses (the ariza is Latin). Two shared blocks from the firms' rekvizit.
const GURUCHARIQ = 'Toshkent shahar, Olmazor tumani, Guruchariq MFY, Sagʻbon koʻchasi 30 berk, 7/1-uy';
const CHINNIOBOD = 'Toshkent shahar, Olmazor tumani, Chinniobod MFY, Chinniobod-2 mavzesi, 7-uy';
const MFO = '01183'; // every firm banks at ANORBANK
const POST = '100174';

/**
 * Full rekvizit for all 9 firms — STIR / X/R / MFO / legal name — ported from the spravka seed
 * («ММТ Реквизитлар.xlsx» + the firms' letterheads), transliterated to Latin for the ariza. The
 * branch `code` is the value embedded in each X/R (…CCCCC001). PRESTIGE has no bank account/MFO on
 * any rekvizit sheet (left blank — fill from Firmalar if it ever gets one).
 */
export const FIRMS_SEED: FirmSeed[] = [
  { code: '12842', shortName: 'BRIGHT FUTURE FINANCING',
    legalName: '«BRIGHT FUTURE FINANCING MIKROMOLIYA TASHKILOTI» MCHJ',
    address: GURUCHARIQ, bankAccount: '20216000207212842001', mfo: MFO, stir: '311 976 765', postIndex: POST,
    // 2026-09-06 jonli tasdiqlangan (ADOLAT qoralamasidan olingan).
    cabinetClaimantId: 'a9c49a63-5b0b-48c6-b2fb-48db85dd6f5a' },
  { code: '06292', shortName: 'URBAN FINANCE SOLUTIONS',
    legalName: '«URBAN FINANCE SOLUTIONS MIKROMOLIYA TASHKILOTI» MCHJ',
    address: CHINNIOBOD, bankAccount: '20216000307206292001', mfo: MFO, stir: '311 943 592', postIndex: POST },
  { code: '55890', shortName: 'COMMUNITY MMT',
    legalName: '«COMMUNITY MICROFINANCE MIKROMOLIYA TASHKILOTI» MCHJ',
    address: CHINNIOBOD, bankAccount: '20216000307255890001', mfo: MFO, stir: '312 191 604', postIndex: POST },
  { code: '05557', shortName: 'MUVAFFAQIYAT MMT',
    legalName: '«MUVAFFAQIYAT MIKROMOLIYA TASHKILOTI» MCHJ',
    address: GURUCHARIQ, bankAccount: '20216000007205557001', mfo: MFO, stir: '311 939 991', postIndex: POST },
  { code: '14276', shortName: 'FUNDFLOW',
    legalName: '«FUNDFLOW MIKROMOLIYA TASHKILOTI» MCHJ',
    address: GURUCHARIQ, bankAccount: '20216000307214276001', mfo: MFO, stir: '311 979 413', postIndex: POST },
  { code: '31685', shortName: 'ZAYMLY',
    legalName: '«ZAYMLY MIKROMOLIYA TASHKILOTI» MCHJ',
    address: CHINNIOBOD, bankAccount: '20216000407331685001', mfo: MFO, stir: '312 500 154', postIndex: POST },
  { code: '31734', shortName: 'DARROWMAD',
    legalName: '«DARROWMAD MIKROMOLIYA TASHKILOTI» MCHJ',
    address: CHINNIOBOD, bankAccount: '20216000307331734001', mfo: MFO, stir: '312 510 309', postIndex: POST },
  { code: '55899', shortName: 'DYNAMIC CREDIT SOLUTIONS MIKROMOLIYA TASHKILOTI',
    legalName: '«DYNAMIC CREDIT SOLUTIONS MIKROMOLIYA TASHKILOTI» MCHJ',
    address: CHINNIOBOD, bankAccount: '20216000007255899001', mfo: MFO, stir: '312 192 769', postIndex: POST },
  { code: '07634', shortName: '"PRESTIGE MOLIYA" MCHJ MMT',
    legalName: '«PRESTIGE MOLIYA MIKROMOLIYA TASHKILOTI» MCHJ',
    address: CHINNIOBOD, stir: '312 811 527', postIndex: POST },
];
