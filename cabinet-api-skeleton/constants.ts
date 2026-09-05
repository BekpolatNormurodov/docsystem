// cabinet-api-skeleton/constants.ts
// cabinet.sud.uz (Adolat e-sud) portali uchun barcha GUID, endpoint va doimiylar ro'yxati.
// Real tizimdan (categories.json, document-types-list.json, Angular bundle) olingan.

export const CABINET_BASE_URL = 'https://cabinetapi.sud.uz';

export const CABINET_ENDPOINTS = {
  // Autentifikatsiya va foydalanuvchi
  userGet: '/api/cabinet/user/get',
  validateCode: '/api/validate-code',

  // Qoralama (Draft) bosqichlari
  draftCreate: '/api/cabinet/pub-user-draft-cases/create',
  draftUpdate: '/api/cabinet/pub-user-draft-cases/', // + {id}
  draftGet: '/api/cabinet/pub-user-draft-cases/get/', // + {id}
  draftList: '/api/cabinet/pub-user-draft-cases/list',
  draftDelete: '/api/cabinet/pub-user-draft-cases/delete/', // + {id}

  // Ishtirokchilar (Da'vogar va Javobgar)
  participantAdd: '/api/cabinet/pub-user-draft-cases/participant/add',
  participantUpdate: '/api/cabinet/pub-user-draft-cases/participant/update',
  participantDelete: '/api/cabinet/pub-user-draft-cases/participant/delete/',

  // Davlat boji va billing kvitansiya
  calcDuties: '/api/cabinet/case/calc-duties-by-params',
  findByReceiptNumber: '/api/cabinet/guide/find-by-receipt-number',
  dutyReasons: '/api/cabinet/general-manuals/duty-reasons',

  // Fayl yuklash (multipart/form-data)
  fileUpload: '/api/cabinet/case/file/upload',

  // Da'voni yakuniy saqlash (Suit / Material)
  saveSuit: '/api/cabinet/case/conflict/save-suit',
  saveMaterial: '/api/cabinet/case/conflict/save-material',
  saveSuitMaterial: '/api/cabinet/case/conflict/save-suit-material',

  // YAKUNIY YUBORISH (Sudga topshirish)
  sendToCourt: '/api/cabinet/case/send-to-court/', // + {id} (PUT so'rov)
} as const;

/**
 * cabinet.sud.uz tizimidagi rasmiy HUJJAT TURLARI GUID'lari (`file_type` headeri uchun).
 * Ushbu GUID'lar fayl yuklash paytida `file_type` sarlavhasida yuborilishi SHART!
 */
export const CABINET_DOC_TYPES = {
  // 1) Palata muhrlagan Ariza (Sud buyrug'i berish to'g'risida ariza)
  ARIZA: '2554784d-b231-4dc9-aadf-819429cfeb70', // code: 1001 "Ariza"
  DAVO_ARIZASI: '1c4b3a7e-3634-4972-8d32-9acc5e782766', // "Даъво аризаси"

  // 2) Qarzdorga yuborilgan rasmiy Talabnoma
  TALABNOMA: 'eb37ed47-d973-40bd-a9cd-a481add9c1ce', // code: 11 "Talabnoma"

  // 3) Talabnoma yuborilganligini tasdiqlovchi pochta cheki (UZPOST kvitansiya)
  TALABNOMA_CHECK: 'f264d870-a254-46b6-95cf-525d9e6a6299', // code: 3 "Аризани томонларга юборилганлигини тасдиқловчи маълумотнома"

  // 4) Savdo-sanoat palatasi ishonchnomasi
  ISHONCHNOMA: 'e55124df-d369-4132-9cd0-635c81ccce3c', // code: 9 "Ишончнома"

  // 5) Tashkilot guvohnomasi
  GUVOHNOMA: '85f9394d-fe3b-4511-a437-3ff7434a48f8', // code: 12 "Гувоҳнома"

  // 6) Boshqa hujjatlar: Shartnoma, Elektron Oferta, Kredit grafigi
  BOSHQA_HUJJATLAR: '616ccb56-4b2f-42ed-8522-7b351d2edb5f', // code: 9 "Бошқа ҳужжатлар"

  // 7) To'lov ma'lumotnomalari (Davlat boji yoki pochta xarajati)
  POCHTA_XARAJATI_KVITANSIYA: '0c94c016-c8d2-4833-9871-46e0d26b28b6', // code: 4
  DAVLAT_BOJI_KVITANSIYA: '4a8d9b8c-5458-47c9-8d4f-2371bffa430e', // code: 3
} as const;

/**
 * Da'vo toifalari (Categories) GUID'lari:
 */
export const CABINET_CATEGORIES = {
  // Sud buyrug'i: yozma bitimga asoslangan va qarzdor tomonidan tan olingan talab
  CIVIL_DECREE_WRITTEN_CONTRACT: '844ba777-f7fa-4a86-a347-8d333d28872d',
  // Fuqarolik: kredit shartnomasiga doir
  CIVIL_SUIT_CREDIT_CONTRACT: 'a103afb6-9245-47bb-85c6-c0388411ddf5',
  // Fuqarolik: qarz undirishga doir
  CIVIL_SUIT_DEBT_COLLECTION: 'd2042a94-e82d-4511-84e4-4aeca98c6842',
} as const;

/**
 * Asosiy sudlar identifikatorlari (portal ichidagi court_id GUID'lari):
 */
export const CABINET_COURT_IDS = {
  // Fuqarolik ishlari bo'yicha Uchtepa tumanlararo sudi
  UCHTEPA_CIVIL: 'f494f85e-b130-433d-ba9c-4afb3620f431',
  // Fuqarolik ishlari bo'yicha Yuqorichirchiq tumanlararo sudi
  YUQORICHIRCHIQ_CIVIL: 'b564e622-83b4-4b55-a50d-40c266ec0fa7',
} as const;

/**
 * DB dagi Court yozuvidan cabinet.sud.uz portal GUID'ini aniqlash.
 * Yuqorichirchiq sudi bo'lsa Yuqorichirchiq GUID'ini, aks holda Uchtepa GUID'ini qaytaradi.
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

