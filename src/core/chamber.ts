/**
 * The one Tashkent branch of the O‘zbekiston Savdo-sanoat palatasi, exactly as the ariza blank
 * prints it. A code constant, not a DB row: there is a single branch, and «faqat qizil = saqlanadi»
 * — the chamber's fixed block is not a per-document value. Promote to an admin-editable settings row
 * if a second regional branch ever appears.
 *
 * Kept verbatim from the source blank, including its spelling («xududiy»).
 */
export const CHAMBER = {
  /** Letterhead line 1 (bold). The blank prints «...boshqarmasi»; «hududiy» is the correct form. */
  branchName: 'Toshkent shahar hududiy boshqarmasi',
  /** Letterhead contact lines, right-aligned under the branch name. The masthead address is the
   *  boshqarma's real address (Mirobod tumani, A.Temur shox koʻchasi 4 — same as the «Arizachi:»
   *  block), not the old «Bobur koʻchasi 30». */
  contact: [
    'Toshkent sh., Mirobod tumani, A.Temur shox koʻchasi 4-uy',
    'tel.: (+998) 95-144-24-00, (+998) 95-144-27-00, 1094',
    'e-mail: th@chamber.uz, www.chamber.uz',
  ],
  /** «Arizachi:» block — the applicant is the chamber itself. */
  applicantName: 'Oʻzbekiston Savdo-sanoat palatasi Toshkent shahar xududiy boshqarmasi',
  applicantAddress: ['Toshkent shahar, Mirobod tumani,', 'A.Temur shox koʻchasi, 4-uy.'],
  applicantStir: '201 800 518',
  /** The right-aligned label above the firm (the member on whose behalf the chamber collects). */
  collectorLabel: ['Palata aʼzosi', 'manfaatida undiruvchi:'],
  /** «Ilova qilingan hujjatlar roʻyxati:» — the six fixed attachments. */
  attachments: [
    'Oʻz SSPga aʼzolik shartnomasi va guvoxnomasi nusxasi;',
    'Arizani imzolash vakolatini beruvchi ishonchnoma nusxasi;',
    'Kredit shartnomasi nusxasi;',
    'Ogohlantirish xatlari nusxasi;',
    'Kredit toʻlash grafigi nusxasi;',
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
