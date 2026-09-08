/**
 * The one Tashkent branch of the O‘zbekiston Savdo-sanoat palatasi, exactly as the ariza blank
 * prints it. A code constant, not a DB row: there is a single branch, and «faqat qizil = saqlanadi»
 * — the chamber's fixed block is not a per-document value. Promote to an admin-editable settings row
 * if a second regional branch ever appears.
 *
 * Kept close to the source blank; «xududiy» corrected to «hududiy» per the operator.
 */
export const CHAMBER = {
  /** Letterhead line 1 (bold). The blank prints «...boshqarmasi»; «hududiy» is the correct form. */
  branchName: 'Toshkent shahar hududiy boshqarmasi',
  /** Letterhead contact lines, right-aligned under the branch name. The masthead address is the
   *  boshqarma's real address (Mirobod tumani, A.Temur shox koʻchasi 4 — same as the «Arizachi:»
   *  block), not the old «Bobur koʻchasi 30». */
  contact: [
    'Toshkent sh, Mirobod tumani, A.Temur shox koʻchasi 4-uy',
    'tel.: (+998) 95-144-24-00, (+998) 95-144-27-00, 1094',
    'e-mail: th@chamber.uz, www.chamber.uz',
  ],
  /** «Arizachi:» block — the applicant is the chamber itself. */
  applicantName: 'Oʻzbekiston Savdo-sanoat palatasi Toshkent shahar hududiy boshqarmasi',
  applicantAddress: ['Toshkent shahar, Mirobod tumani,', 'A.Temur shox koʻchasi, 4-uy.'],
  applicantStir: '201 800 518',
  /** The right-aligned label above the firm (the member on whose behalf the chamber collects). */
  collectorLabel: ['Palata aʼzosi', 'manfaatida undiruvchi:'],
  /**
   * «Ilova qilingan hujjatlar roʻyxati:» — arizada bosiladigan ilovalar ro'yxati.
   *
   * BU RO'YXAT — SUD BILAN TUZILGAN SHARTNOMA. Sudya arizani o'qib, ilovalarni AYNAN shu
   * tartibda va AYNAN shu tarkibda kutadi. Shuning uchun har bandning qarshisida uni
   * QAYSI hujjat bajarishi yozib qo'yilgan; sudga yuborishda fayllar shu tartibga solinadi
   * (`COURT_FILE_ORDER`, src/lib/court-submit-job.ts).
   *
   * Ro'yxatga band QO'SHISH — biriktiriladigan hujjat ham qo'shilishini talab qiladi.
   * Aks holda sud «ro'yxatda bor, o'zi yo'q» deb qaytaradi.
   *
   * 2026-09-08: «Kredit toʻlash grafigi nusxasi» OLIB TASHLANDI (operator qarori). U hech
   * qachon biriktirilmagan — ariza uni va'da qilar, paketda esa yo'q edi (sudga yuborishda
   * grafik umuman yaratilmaydi, ZIP'da ham `includeGrafik: false`). Ro'yxatda qolgani
   * sudning «hujjatlar tartibsiz» degan e'tiroziga qo'shimcha asos berardi.
   */
  attachments: [
    // 1 → FirmDocument.SHARTNOMA + FirmDocument.GUVOHNOMA (firma kutubxonasidan)
    'Oʻz SSPga aʼzolik shartnomasi va guvoxnomasi nusxasi;',
    // 2 → FirmDocument.ISHONCHNOMA
    'Arizani imzolash vakolatini beruvchi ishonchnoma nusxasi;',
    // 3 → OFERTA (har kredit uchun bittadan, portfeldan generatsiya qilinadi)
    'Kredit shartnomasi nusxasi;',
    // 4 → TALABNOMA (+ ketidan uning UZPOST yetkazish kvitansiyasi)
    'Ogohlantirish xatlari nusxasi;',
    // 5 → billing.sud.uz kvitansiyasi PDF (InvoiceRecord.pdfPath)
    'Pochta xarajat toʻlanganligi haqida toʻlov topshiriqnoma.',
  ],
} as const;

/**
 * Defaults for the palata's editable signer and executor. They live here, not in the DB — switching
 * the ariza on pre-fills these so the common case is one save, and the operator can still change them
 * per document (they are stored on the row when they do).
 */
export const CHAMBER_SIGNER = {
  position: 'Boshqarma boshligʻi oʻrinbosari',
  name: 'B.Babamuradov',
  executorName: 'B.Fayziyev',
  executorPhone: '+99895-144-24-00',
} as const;
