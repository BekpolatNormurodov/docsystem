// cabinet-api-skeleton/constants.ts
// cabinet.sud.uz (ADOLAT e-sud) portali uchun endpoint va doimiylar.
//
// 2026-09-06 TUZATISH: ilgari bu faylda `participantAdd` va `draftGet` deb nomlangan
// endpointlar bor edi — ikkovi ham LIVE sinovda 404 ("Cannot POST/GET ...") berdi. Haqiqiy
// API bitta resursga (`pub-user-draft-cases/{id}`) qayta-qayta PUT qiladigan wizard —
// alohida participant/get endpoint'lari UMUMAN YO'Q. Quyida faqat LIVE tasdiqlangan
// endpointlar qoldirilgan; www.

export const CABINET_BASE_URL = 'https://cabinetapi.sud.uz';

export const CABINET_ENDPOINTS = {
  // Autentifikatsiya va foydalanuvchi (mavjud, ishlaydi — src/lib/cabinet/oneid.ts / session.ts)
  userGet: '/api/cabinet/user/get',
  validateCode: '/api/validate-code',

  // Qoralama (Draft) — LIVE TASDIQLANGAN 2026-09-06:
  draftCreate: '/api/cabinet/pub-user-draft-cases/create',      // POST {}
  draftUpdate: '/api/cabinet/pub-user-draft-cases/',             // PUT + {id}, body {details:{...}}
  draftList: '/api/cabinet/pub-user-draft-cases/list',           // GET — barcha draftlar TO'LIQ details bilan
  draftDelete: '/api/cabinet/pub-user-draft-cases/delete/',      // PUT + {id} (body yo'q)
  // draftGet — ATAYIN OLIB TASHLANDI: `/get/{id}` 404 beradi. Bitta draftni o'qish kerak
  // bo'lsa draftList'ni chaqirib natijadan `id` bo'yicha filtrlang.

  // Ma'lumotnomalar (guide/public) — LIVE TASDIQLANGAN:
  categories: '/api/cabinet/guide/categories',           // GET ?claim_type=CIVIL — asosiy turkumlar
  subCategories: '/api/cabinet/guide/categories/sub',    // GET ?claim_type=CIVIL — parent_id bilan bog'langan
  courts: '/api/public/guides/courts',                   // GET ?court_type=CIVIL
  regions: '/api/public/guides/regions',                 // GET

  // Davlat boji kvitansiyasi qidirish — FAQAT haqiqiy davlat-boji-to'lovchi ishlar uchun
  // (bizning palata/mikroqarz ishlarimiz bojidan OZOD — bu endpointni ULARGA chaqirmang,
  // "Квитанция топилмади" qaytaradi. types.ts'dagi FindReceiptPayload izohiga qarang).
  findByReceiptNumber: '/api/cabinet/guide/find-by-receipt-number', // POST {receipt_number}

  // Fayl yuklash — mavjud, ishlaydi (src/lib/cabinet/api.ts uploadFile bilan bir xil naqsh)
  fileUpload: '/api/cabinet/case/file/upload',           // POST multipart + header file_type:<GUID>

  // YAKUNIY YUBORISH — HECH QACHON CHAQIRILMASIN. src/lib/cabinet/api.ts SEND_TO_COURT_PREFIX
  // guard'i shu prefiksni to'sib turadi.
  sendToCourt: '/api/cabinet/case/send-to-court/',       // PUT + {id} — QAYTMAS, faqat inson UI'dan
} as const;

/**
 * cabinet.sud.uz tizimidagi rasmiy HUJJAT TURLARI GUID'lari (`file_type` headeri uchun).
 * ESLATMA: bular avvalgi (participant/add kabi noto'g'ri chiqqan) reverse-engineer bosqichidan
 * qolgan — LIVE qayta tasdiqlanmagan, lekin CABINET_CATEGORIES bilan bir manbadan kelgan va u
 * mustaqil tekshiruvda 100% to'g'ri chiqdi, shuning uchun yuqori ishonch bilan qoldirildi.
 * BIRINCHI haqiqiy yuklashda serverning javobini (fileId qaytishi, 400 emasligini) tekshiring.
 */
export const CABINET_DOC_TYPES = {
  ARIZA: '2554784d-b231-4dc9-aadf-819429cfeb70',                    // Palata muhrlagan Ariza (signed-ariza skan)
  DAVO_ARIZASI: '1c4b3a7e-3634-4972-8d32-9acc5e782766',
  TALABNOMA: 'eb37ed47-d973-40bd-a9cd-a481add9c1ce',
  TALABNOMA_CHECK: 'f264d870-a254-46b6-95cf-525d9e6a6299',          // TALABNOMA_RECEIPT (xat.hippo UZPOST)
  ISHONCHNOMA: 'e55124df-d369-4132-9cd0-635c81ccce3c',
  GUVOHNOMA: '85f9394d-fe3b-4511-a437-3ff7434a48f8',
  BOSHQA_HUJJATLAR: '616ccb56-4b2f-42ed-8522-7b351d2edb5f',         // Shartnoma, Oferta, Grafik
  POCHTA_XARAJATI_KVITANSIYA: '0c94c016-c8d2-4833-9871-46e0d26b28b6', // bizning billing.sud.uz kvitansiyasi SHU YERGA (fayl sifatida)
  DAVLAT_BOJI_KVITANSIYA: '4a8d9b8c-5458-47c9-8d4f-2371bffa430e',    // bizga tegishli emas (dutyexempt)
} as const;

/**
 * Da'vo toifalari — LIVE TASDIQLANGAN 2026-09-06 (GET /api/cabinet/guide/categories dan
 * to'g'ridan-to'g'ri olindi, eski taxminlar bilan AYNAN mos chiqdi):
 */
export const CABINET_CATEGORIES = {
  // "111 — ёзма битимга асосланган ва қарздор томонидан тан олинган талаб" (yozma bitim,
  // masalan mikroqarz shartnomasi asosida undirish). duty_for_organization="10.00" (lekin
  // palata a'zolari uchun bu ariza turi bojisiz — pastroqdagi izohga qarang).
  CIVIL_DECREE_WRITTEN_CONTRACT: '844ba777-f7fa-4a86-a347-8d333d28872d',
} as const;

/**
 * Sub-kategoriya (ikkilamchi ish turkumi) — parent_id CIVIL_DECREE_WRITTEN_CONTRACT ga teng.
 * "111.2 — майда ва маиший кредит тўловларини ундириш" — mikroqarz/iste'mol krediti undirish,
 * bizning MMT (mikromoliya tashkiloti) ishlarimizga aynan mos keladigan sub-kategoriya.
 */
export const CABINET_SUB_CATEGORIES = {
  SMALL_CONSUMER_CREDIT: 'ddb94ed0-d043-4f52-9b80-77f51a76a36a',
} as const;

/**
 * Asosiy sudlar identifikatorlari (portal ichidagi court_id GUID'lari) — LIVE TASDIQLANGAN.
 */
export const CABINET_COURT_IDS = {
  UCHTEPA_CIVIL: 'f494f85e-b130-433d-ba9c-4afb3620f431',
  YUQORICHIRCHIQ_CIVIL: 'b564e622-83b4-4b55-a50d-40c266ec0fa7',
} as const;

/** Toshkent viloyati/shahar region GUID — LIVE TASDIQLANGAN (createApplication.region maydoni). */
export const CABINET_REGION_IDS = {
  TOSHKENT_VILOYATI: '7b339e6d-1151-d564-001f-bbfa8e5552ab',
} as const;

/**
 * DB dagi Court yozuvidan cabinet.sud.uz portal GUID'ini aniqlash.
 */
export function resolveCabinetCourtGuid(court?: {
  shortName?: string | null;
  nameUz?: string | null;
  billingCourtId?: string | null;
} | null): string {
  if (!court) return CABINET_COURT_IDS.UCHTEPA_CIVIL;
  const s = `${court.shortName || ''} ${court.nameUz || ''}`.toLowerCase();
  if (s.includes('yuqorichirchiq') || s.includes('юкоричирчик') || court.billingCourtId === '587') {
    return CABINET_COURT_IDS.YUQORICHIRCHIQ_CIVIL;
  }
  return CABINET_COURT_IDS.UCHTEPA_CIVIL;
}

// ⛔ FINAL SUBMIT — irreversible. NEVER call without explicit human intent.
//   PUT /api/cabinet/case/send-to-court/{id}  body {}
export const SEND_TO_COURT_PREFIX = CABINET_ENDPOINTS.sendToCourt;
