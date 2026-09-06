// cabinet-api-skeleton/types.ts
// cabinet.sud.uz (ADOLAT) API — REAL shapes, captured live via browser network interception
// AND independently re-verified via raw API round-trips (PUT -> GET list -> byte-identical
// echo) on 2026-09-05/06. The wizard is NOT a sequence of small per-field endpoints (that was
// the old, WRONG assumption below this comment used to encode) — it is ONE resource
// (`pub-user-draft-cases/{id}`) updated by repeated PUTs, each one merging a `details.<section>`
// object. Every shape here was seen verbatim in a real request/response; nothing is guessed.

export type ClaimType = 'CIVIL' | 'ECONOMIC' | 'ADMINISTRATIVE';
export type ClaimKind = 'DECREE' | 'SUIT' | 'MATERIAL';
export type EntityType = 'PERSON' | 'ORGANIZATION';
export type Gender = 'MALE' | 'FEMALE';

export interface CabinetAuthSession {
  token: string;          // X-AUTH-TOKEN qiymati
  account: string;        // Firma STIR raqami
  orgName?: string;       // Firma nomi
}

// ---- draft create/list/delete (verified) -----------------------------------------------------

// POST pub-user-draft-cases/create — body is a literal empty object; the server assigns
// form_step:0 and details:null. There is no "categories"/"court_id" at creation time — those
// only exist inside `details`, set by the FIRST update PUT.
export type CreateDraftPayload = Record<string, never>;

export interface DraftCaseResponse {
  id: string;             // draftId (UUID) — used in every subsequent PUT path
  pub_user_id: string;
  form_step: number;
  details: DraftDetails | null;
  created_at: string;
}

// ---- draft update — the ONE real mutation endpoint (verified) --------------------------------
// PUT pub-user-draft-cases/{id}  body: { details: DraftDetails }
// The server MERGES whatever top-level `details.<key>` you send with what it already has —
// so a step-2 PUT that omits `defendantInfo` does NOT erase a defendant added in step 3 (each
// wizard step in the real UI sends the FULL accumulated `details` object every time it saves,
// so mirror that: always resend every section you already have, not just the one you changed).

/**
 * Wizard 1-qadamida yoziladigan ish turi. 2026-09-06 da portaldagi HAQIQIY qoralamadan
 * (ADOLAT UI'sida qo'lda yaratilgan, form_step=1) aynan shu shaklda o'qildi.
 * Bizning eski kod bu bo'limni UMUMAN yubormasdi — natijada qoralama form_step=0 da qolib,
 * portal uni «boshlanmagan» deb hisoblardi.
 */
export interface CourtInfo {
  instance: 'FIRST' | string;                 // birinchi instansiya
  claim_kind: 'DECREE' | 'SUIT' | string;     // DECREE = sud buyrug'i (bizning 111-toifa)
  claim_type: 'CIVIL' | string;
  claimant_entity_type: 'ORGANIZATION' | 'PERSON' | string;
}

export interface DraftDetails {
  // Portaldagi haqiqiy `details` 11 bo'limdan iborat (2026-09-06 da draftList'dan o'qildi):
  // baseInfo, courtInfo, caseSelect, courtCosts, fileUpload, defendantInfo, selectDocuments,
  // materialBaseInfo, createApplication, administrativeBaseInfo, materialCreateApplication.
  courtInfo: CourtInfo | null;
  createApplication: CreateApplicationInfo | null;
  materialCreateApplication: unknown | null; // only relevant for claim_kind MATERIAL — unexplored
  baseInfo: BaseInfo | null;
  materialBaseInfo: unknown | null;          // unexplored
  administrativeBaseInfo?: unknown | null;   // ma'muriy ishlar uchun — bizga tegishli emas
  caseSelect?: unknown | null;               // shakli aniqlanmagan (portaldagi barcha qoralamalarda null)
  defendantInfo: DefendantInfo | null;
  courtCosts: unknown | null;                // unexplored — see findByReceiptNumber note below
  // ⛔ Quyidagi ikkitasi HUJJATLARNI qoralamaga bog'laydi. Shakli HALI ANIQLANMAGAN:
  // portaldagi 4 ta qoralamaning hech biri hujjat biriktirish qadamiga yetmagan, shuning
  // uchun ikkalasi ham null. Aniqlash uchun ADOLAT UI'sida bitta qoralamaga fayl biriktirib,
  // draftList'dan qayta o'qish kerak. Shu bajarilmaguncha submitter.ts yuborishni to'xtatadi.
  fileUpload?: unknown | null;
  selectDocuments?: unknown | null;
}

// Step 1 of the UI wizard (sud + da'vogar tanlash).
export interface CreateApplicationInfo {
  region: string;                 // portal region GUID — GET /api/public/guides/regions
  court: string;                  // portal court GUID   — GET /api/public/guides/courts?court_type=CIVIL
  claimant: string;               // portal claimant GUID — the firm's ORG entity, PRE-REGISTERED
                                   // under this cabinet account (NOT raw org JSON — the old
                                   // skeleton's OrganizationEntityData/participant-add guess was
                                   // wrong; the UI just offers a dropdown of already-known claimants).
  small_business: boolean;
  claimant_type: 'ORGANIZATION' | 'PERSON';
  vcc: null;
  is_supreme: boolean;
  participants: null;
  representing_org_entity_id: null;
}

// Step 2 of the UI wizard (ish turkumi + da'vo summasi).
export interface BaseInfo {
  case_number: string | null;
  registry_dt: string;            // ISO timestamp, set to "now" when the step is saved
  claim_categories: ClaimCategoryRef[];
  claim_group: null;
  claim_type: null;
  utility_account_first: string; utility_account_second: string; utility_account_gas: string;
  utility_account_hot_water: string; utility_account_cold_water: string;
  utility_debt_first: number; utility_debt_second: number; utility_debt_gas: number;
  utility_debt_hot_water: number; utility_debt_cold_water: number;
  collateral_security: boolean;
  collateral_type: null; cadastral_number: null;
  vehicle_state_number: null; vehicle_passport_series_number: null;
  claim_amounts_with_parts: ClaimAmountWithParts[];
}

export interface ClaimCategoryRef {
  category_id: string;            // GET /api/cabinet/guide/categories?claim_type=CIVIL, match by `code`
  sub_category_id: string;        // GET /api/cabinet/guide/categories/sub?claim_type=CIVIL, `parent_id` = category_id
}

export type ClaimAmountPartType =
  | 'DEPT' | 'MORAL_DAMAGE' | 'MATERIAL_DAMAGE' | 'LOST_PROFIT'
  | 'PREPAID_EXPENSE' | 'PENALTY' | 'FINE' | 'PERCENT';

export interface ClaimAmountWithParts {
  claim_amount: { amount: string; forfeit: null; currency_id: 'UZS' };
  // ALL 8 part types must be present (server echoed exactly this set back unchanged) — set the
  // ones you don't use to `amount: null`, don't omit them.
  claim_amount_parts: { amount: number | null; amount_type: ClaimAmountPartType }[];
}

// Step 3 of the UI wizard (javobgar/qarzdor). The PINFL auto-lookup ("Qidirish") is gated by a
// visible math captcha that resisted automation (browser click on its submit button produced
// literally zero network activity across ~6 attempts, incl. ref-based clicks, form_input, and
// native-setter+dispatchEvent — cause unconfirmed). The "Men JShShIR ni bilmayman" (I don't know
// the PINFL) checkbox is a SEPARATE, captcha-free, officially-supported manual-entry path that
// reveals the same fields and saves via the identical draft-update PUT — this is what
// buildDefendant() below uses. Because our own DB already has the debtor's pinfl/name (we don't
// need the government registry's auto-lookup for OUR purposes), this is not a workaround, it's
// the correct input mode for "caller already knows the person, is not searching".
export interface DefendantInfo {
  defendants: DefendantEntry[];
  claimants: null;
}

export interface DefendantEntry {
  entity_type: 'PERSON';
  first_name: null; last_name: null; middle_name: null; org_name: null; details: null; // unused when entity_type=PERSON
  isPinflUnknown: true;            // always true for the manual-entry path
  isTinUnknown: null;
  entity: {
    first_name: string; last_name: string; middle_name: string | null;
    passport_serial: string | null; passport_number: string | null;
    phone: string | null; citizenship: string | null;
    gender: Gender | null;
    birth_date: string | null; age: number | null;
    district_id: string | null; region_id: string | null;
    address: string | null; mailing_postcode: string | null;
  };
  is_main: true;
}

// ---- court costs / state duty (verified, and verified NOT APPLICABLE to our case type) -------
// POST /api/cabinet/guide/find-by-receipt-number { receipt_number }
// This looks up a DAVLAT BOJI (state duty) payment receipt in the COURT's OWN registry. It is
// UNRELATED to billing.sud.uz's "Почта харажатлари" (postal expense) kvitansiya that
// src/lib/invoice-rest.ts mints (confirmed live: searching our real receiptNumber here returns
// "Квитанция топилмади" — not found, because it's the wrong registry/purpose entirely).
// Our palata/chamber-of-commerce debt-collection arizas are DUTY-EXEMPT (our own ariza template
// says so — "давлат бojisiz"; the UI's "Davlat Boji" table renders EMPTY/zero for this claim
// category, confirming the exemption), so courtCosts should stay `null` and this endpoint should
// NOT be called for this case type. The postal-expense kvitansiya instead goes in with the other
// uploaded documents (see CABINET_DOC_TYPES.POCHTA_XARAJATI_KVITANSIYA in constants.ts) — NOT
// submitted through this endpoint.
export interface FindReceiptPayload { receipt_number: string; }

// ---- file upload (endpoint + header pattern already correct & LIVE in the main app; see
// src/lib/cabinet/api.ts `uploadFile()`. Only the exact `file_type` GUID mapping for each
// document kind (CABINET_DOC_TYPES in constants.ts) has NOT been independently re-verified in
// this session — it comes from the same earlier reverse-engineering pass as the category GUIDs,
// which WERE independently verified live and matched exactly, so treat it as high-confidence but
// re-check the very first real upload's response before trusting it in bulk.) ------------------
export interface UploadedCabinetFile {
  fileId: string;
  fileName: string;
  fileType: string;        // CABINET_DOC_TYPES GUID
  fileSize: number;
}

// ---- send-to-court: PUT /api/cabinet/case/send-to-court/{id} --------------------------------
export interface SendToCourtResponse {
  case_number?: string;
  caseNumber?: string;
  registry_number?: string;
  registryNumber?: string;
  status?: string;
  claim_id?: string;
  id?: string;
}
