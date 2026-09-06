// cabinet-api-skeleton/builder.ts
// docsystem ma'lumotlarini cabinet.sud.uz'ning HAQIQIY (2026-09-06 browser+API orqali
// tasdiqlangan) draft-update payload'iga aylantiruvchi adapter. Eski versiya
// (CreateDraftPayload{instance,claim_type,...}, AddParticipantPayload, SaveSuitPayload) BUTUNLAY
// noto'g'ri taxmin edi — haqiqiy API alohida "create draft with categories" yoki
// "add participant" endpoint'lariga EGA EMAS; hammasi bitta `details` obyektini PUT qiladigan
// draft-update chaqiruvi. Quyidagi funksiyalar shu haqiqiy shaklni quradi.

import { CABINET_CATEGORIES, CABINET_SUB_CATEGORIES, CABINET_COURT_IDS, CABINET_REGION_IDS, CABINET_DOC_TYPES } from './constants';
import type {
  CreateApplicationInfo, BaseInfo, DefendantInfo, ClaimAmountPartType, CourtInfo,
  FileUploadSection, UploadedFileRef, CaseDocumentRef, CourtCostsSection, ClaimAmountWithParts,
  CaseParticipantEntry, SaveSuitPayload,
} from './types';

export interface SourceCaseData {
  courtId?: string;      // portal court GUID (CABINET_COURT_IDS) — default Yuqorichirchiq bo'lmasa Uchtepa
  regionId?: string;     // portal region GUID — default Toshkent viloyati
  // TODO(claimant-lookup): claimantId hozircha QO'LDA berilishi kerak. Har firmaning
  // cabinet.sud.uz akkaunti o'zining bitta ORGANIZATION claimant'iga ega (masalan BRIGHT
  // FUTURE FINANCING E-IMZO kaliti bilan kirilganda "Da'vogar nomi" avtomatik shu firmaga
  // tushadi) — buni har firma uchun BIR MARTA (draft yaratib, birinchi PUT javobidagi
  // details.createApplication.claimant qiymatini o'qib) topib, Firm modelida (yoki shu faylda
  // firmStir -> claimantId lug'atida) saqlash kerak. Hozircha bu funksiyaga tashqaridan uzatiladi.
  claimantId: string;
  firm: { stir: string };
  debtor: {
    pinfl: string;               // faqat ma'lumot uchun — DefendantInfo'ga ketmaydi (isPinflUnknown:true)
    fullName: string;
    firstName?: string; lastName?: string; middleName?: string;
    passportSerial?: string; passportNumber?: string;
    phone?: string;
    // TODO(gender-from-portfolio): portfelda (Loan.raw yoki alohida ustun) jinsi bo'lsa o'shandan
    // olinsin — hozircha ismning odatiy jinsi asosida taxmin qilinadi (aniq emas!).
    gender?: 'MALE' | 'FEMALE';
    birthDate?: string;           // YYYY-MM-DD
    address?: string;
    districtId?: string; regionId?: string; // javobgarning yashash hududi GUID (topilmagan — null qoladi)
  };
  debt: {
    principal: number; interest: number; penalty: number; fine: number;
    moralDamage: number; materialDamage: number; lostProfit: number; prepaidExpense: number;
    total: number;
  };
}

export class CabinetPayloadBuilder {
  /** Step 2: Qoralama (Draft) yaratish payload — LIVE tasdiqlangan: haqiqatan {} bo'sh. */
  static buildDraft(): Record<string, never> {
    return {};
  }

  /**
   * Wizard 1-qadam: ish turi. Portaldagi UI qoralamasidan (form_step=1) aynan shu shaklda
   * o'qildi. DECREE = sud buyrug'i tartibi — 111-toifaga («ёзма битимга асосланган ва қарздор
   * томонидан тан олинган талаб») mos keladi. Boshqa turdagi da'vo kerak bo'lsa bu yerni
   * parametrlash kerak.
   */
  static buildCourtInfo(): CourtInfo {
    return {
      instance: 'FIRST',
      claim_kind: 'DECREE',
      claim_type: 'CIVIL',
      claimant_entity_type: 'ORGANIZATION',
    };
  }

  /** Wizard step 1: sud + da'vogar. */
  static buildCreateApplication(data: SourceCaseData): CreateApplicationInfo {
    return {
      region: data.regionId || CABINET_REGION_IDS.TOSHKENT_VILOYATI,
      court: data.courtId || CABINET_COURT_IDS.UCHTEPA_CIVIL,
      claimant: data.claimantId,
      small_business: false,
      claimant_type: 'ORGANIZATION',
      vcc: null,
      is_supreme: false,
      participants: null,
      representing_org_entity_id: null,
    };
  }

  /**
   * Wizard step 2: ish turkumi + da'vo summasi. `categoryCode`/`subCategoryCode` hozircha faqat
   * bitta variant bilan ishlaydi (mikroqarz undirish, 111/111.2) — boshqa turdagi da'vo kerak
   * bo'lsa CABINET_CATEGORIES/CABINET_SUB_CATEGORIES'ga yangi GUID qo'shib shu yerga uzating.
   */
  static buildBaseInfo(debt: SourceCaseData['debt']): BaseInfo {
    const parts: { amount: number | null; amount_type: ClaimAmountPartType }[] = [
      { amount: debt.principal || null, amount_type: 'DEPT' },
      { amount: debt.moralDamage || null, amount_type: 'MORAL_DAMAGE' },
      { amount: debt.materialDamage || null, amount_type: 'MATERIAL_DAMAGE' },
      { amount: debt.lostProfit || null, amount_type: 'LOST_PROFIT' },
      { amount: debt.prepaidExpense || null, amount_type: 'PREPAID_EXPENSE' },
      { amount: debt.penalty || null, amount_type: 'PENALTY' },
      { amount: debt.fine || null, amount_type: 'FINE' },
      { amount: debt.interest || null, amount_type: 'PERCENT' },
    ];
    return {
      case_number: null,
      registry_dt: new Date().toISOString(),
      claim_categories: [
        { category_id: CABINET_CATEGORIES.CIVIL_DECREE_WRITTEN_CONTRACT, sub_category_id: CABINET_SUB_CATEGORIES.SMALL_CONSUMER_CREDIT },
      ],
      claim_group: null, claim_type: null,
      utility_account_first: '', utility_account_second: '', utility_account_gas: '',
      utility_account_hot_water: '', utility_account_cold_water: '',
      utility_debt_first: 0, utility_debt_second: 0, utility_debt_gas: 0,
      utility_debt_hot_water: 0, utility_debt_cold_water: 0,
      collateral_security: false, collateral_type: null, cadastral_number: null,
      vehicle_state_number: null, vehicle_passport_series_number: null,
      claim_amounts_with_parts: [{
        claim_amount: { amount: debt.total.toFixed(2), forfeit: null, currency_id: 'UZS' },
        claim_amount_parts: parts,
      }],
    };
  }

  /**
   * Wizard step 3: javobgar (qarzdor). PINFL bo'yicha avto-qidirish (captcha) automatlashtira
   * olinmadi (2026-09-06, ~6 urinish — bosim network so'rov chiqarmadi). "Men JShShIR ni
   * bilmayman" (isPinflUnknown:true) — captchasiz, rasmiy qo'lda-kiritish yo'li ishlatiladi;
   * bizning bazamizda debtor haqida yetarli ma'lumot bor, hukumat registridan qidirish shart emas.
   */
  static buildDefendantInfo(debtor: SourceCaseData['debtor']): DefendantInfo {
    const parts = (debtor.fullName || '').trim().split(/\s+/);
    return {
      claimants: null,
      defendants: [{
        entity_type: 'PERSON',
        first_name: null, last_name: null, middle_name: null, org_name: null, details: null,
        isPinflUnknown: true,
        isTinUnknown: null,
        entity: {
          first_name: debtor.firstName || parts[1] || 'SHAXS',
          last_name: debtor.lastName || parts[0] || 'QARZDOR',
          middle_name: debtor.middleName || parts.slice(2).join(' ') || null,
          passport_serial: debtor.passportSerial?.toUpperCase() || null,
          passport_number: debtor.passportNumber || null,
          phone: debtor.phone || null,
          citizenship: null,
          gender: debtor.gender || null,
          birth_date: debtor.birthDate || null,
          age: null,
          district_id: debtor.districtId || null,
          region_id: debtor.regionId || null,
          address: debtor.address || null,
          mailing_postcode: null,
        },
        is_main: true,
      }],
    };
  }

  /**
   * Wizard "Hujjatlar" qadami (details.fileUpload). Birinchi ARIZA turidagi fayl
   * `claimApplication` bo'ladi (portal uni MAJBURIY deb belgilaydi), qolganlari
   * `category_files` ga tushadi.
   */
  static buildFileUpload(files: UploadedFileRef[]): FileUploadSection {
    const ariza = files.find((f) => f.type_id === CABINET_DOC_TYPES.ARIZA)
      ?? files.find((f) => f.type_id === CABINET_DOC_TYPES.DAVO_ARIZASI)
      ?? null;
    return {
      claimApplication: ariza,
      lawyer_order: null,
      category_files: files.filter((f) => f !== ariza),
      additional_files: [],
    };
  }

  /**
   * `P0(fileUpload)` — portal frontendidagi yassilash funksiyasi (main.js dan aynan
   * o'qildi): har bo'limdan `{file_id, type_id}` yig'iladi, tartibi —
   * claimApplication → lawyer_order → category_files → additional_files.
   */
  static buildCaseDocuments(fu: FileUploadSection): CaseDocumentRef[] {
    const out: CaseDocumentRef[] = [];
    const push = (r?: UploadedFileRef | null) => {
      if (r?.file_id) out.push({ file_id: r.file_id, type_id: r.type_id });
    };
    push(fu.claimApplication);
    push(fu.lawyer_order);
    for (const f of fu.category_files || []) push(f);
    for (const f of fu.additional_files || []) push(f);
    return out;
  }

  /**
   * Sud xarajatlari. `case_details.state_duty_amount` SHUNDAN o'qiladi — bo'lmasa portal
   * yiqiladi, shuning uchun har doim yuboriladi.
   *
   * TODO(duty-reason): bojdan ozod qilish ASOSI (duty_reason_id) — YURIDIK tanlov, kodda
   * taxmin qilinmaydi. GET /guide/duty-reasons 12 ta variant qaytaradi (masalan «Давлат божи
   * тўғрисидаги қонуннинг 8/9/10-моддасига асосан озод этилган»). Qaysi modda bizning
   * mikroqarz undirish da'vosiga tegishli ekanini yurist tasdiqlashi va Firm/Setting'ga
   * yozilishi kerak. Berilmasa — boj to'lanishi kerak deb hisoblanadi.
   */
  static buildCourtCosts(opts: { stateFee?: number; dutyReasonId?: string | null } = {}): CourtCostsSection {
    return {
      stateFee: opts.stateFee ?? 0,
      customStateFee: null,
      duty_reason_id: opts.dutyReasonId ?? null,
      receipts: [],
    };
  }

  /** Da'vogar (bizning firma) — save-suit ishtirokchisi. */
  static buildClaimantParticipant(data: SourceCaseData): CaseParticipantEntry {
    return {
      entity: { id: data.claimantId },
      participant: { type: 'CLAIMANT', is_main: true, is_appellant: false },
      entity_details: { is_small_business: false },
    };
  }

  /**
   * Javobgar (qarzdor) — save-suit ishtirokchisi. Shakli portal `getParticipant()`
   * funksiyasidan olindi: PERSON uchun entity_details ichida is_current/entity_type/
   * citizenship va shaxs ma'lumotlari.
   */
  static buildDefendantParticipant(debtor: SourceCaseData['debtor']): CaseParticipantEntry {
    const d = CabinetPayloadBuilder.buildDefendantInfo(debtor).defendants[0];
    return {
      entity: { pinfl: 0, tin: 0, not_citizen: true },
      participant: { type: 'DEFENDANT', is_main: true, is_appellant: false },
      entity_details: {
        is_current: true,
        is_small_business: false,
        entity_type: 'PERSON',
        photo_id: null,
        ...d.entity,
        // buildDefendantInfo `citizenship: null` beradi; portal esa aniq qiymat kutadi —
        // shuning uchun spread'dan KEYIN qo'yiladi (aks holda null ustiga yozib ketardi).
        citizenship: d.entity.citizenship ?? 'UZB_CITIZEN',
      },
    };
  }

  /**
   * `claim_amounts_with_parts` ichidagi barcha summalarni son-satrga aylantiradi.
   * 2026-09-06 jonli sinov: save-suit `amount` maydonini SON qabul qilmaydi —
   * `claim_amounts_with_parts.0.claim_amount_parts.0.amount must be a number string`.
   * `null` (ishlatilmagan summa turlari) o'z holicha qoldiriladi.
   */
  static amountsToNumberStrings(items: ClaimAmountWithParts[]): ClaimAmountWithParts[] {
    const toStr = (v: unknown): any => {
      if (v === null || v === undefined || v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n.toFixed(2) : null;
    };
    return (items || []).map((it) => ({
      ...it,
      claim_amount: { ...it.claim_amount, amount: toStr(it.claim_amount?.amount) },
      claim_amount_parts: (it.claim_amount_parts || []).map(
        (p: { amount: unknown; amount_type: ClaimAmountPartType }) => ({ ...p, amount: toStr(p.amount) }),
      ),
    })) as ClaimAmountWithParts[];
  }

  /**
   * HAQIQIY sud ishini yaratish payloadi (POST /api/cabinet/case/civil/save-suit).
   * Shakli portal bundle'idagi `formToCaseCreate` dan olingan — REAL-API-FINDINGS.md.
   */
  static buildSaveSuit(args: {
    data: SourceCaseData;
    courtInfo: CourtInfo;
    createApplication: CreateApplicationInfo;
    baseInfo: BaseInfo;
    fileUpload: FileUploadSection;
    courtCosts: CourtCostsSection;
  }): SaveSuitPayload {
    const { data, courtInfo, createApplication, baseInfo, fileUpload, courtCosts } = args;
    return {
      case: {
        doc_date: baseInfo.registry_dt,
        doc_number: baseInfo.case_number,
        court_id: createApplication.court,
        duty_reason_id: courtCosts.duty_reason_id ?? null,
      },
      claim_categories: baseInfo.claim_categories,
      receipts: courtCosts.receipts ?? [],
      case_documents: CabinetPayloadBuilder.buildCaseDocuments(fileUpload),
      case_participants: [
        CabinetPayloadBuilder.buildClaimantParticipant(data),
        CabinetPayloadBuilder.buildDefendantParticipant(data.debtor),
      ],
      // Portal `amount` ni SON-SATR sifatida kutadi (400: "must be a number string").
      // Frontend ham aynan shu konversiyani qiladi — `convertClaimAmountWithPartsToStringNumber`.
      // Qoralama (details.baseInfo) ichida son bo'lib turaveradi; faqat save-suit paytida
      // satrga aylantiriladi.
      claim_amounts_with_parts: CabinetPayloadBuilder.amountsToNumberStrings(baseInfo.claim_amounts_with_parts),
      claim: { claim_kind: courtInfo.claim_kind },
      case_details: { state_duty_amount: Number(courtCosts.customStateFee) || Number(courtCosts.stateFee) || 0 },
    };
  }
}
