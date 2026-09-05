// cabinet-api-skeleton/types.ts
// cabinet.sud.uz API so'rovlari va javoblarining to'liq TypeScript interfeyslari.

export type InstanceType = 'FIRST' | 'APPEAL' | 'CASSATION';
export type ClaimType = 'CIVIL' | 'ECONOMIC' | 'ADMINISTRATIVE';
export type ClaimKind = 'DECREE' | 'SUIT' | 'MATERIAL';
export type ParticipantType = 'CLAIMANT' | 'DEFENDANT' | 'THIRD_PARTY';
export type EntityType = 'PERSON' | 'ORGANIZATION';

/**
 * Step 1: Sessiya tokeni
 */
export interface CabinetAuthSession {
  token: string;          // X-AUTH-TOKEN qiymati
  account: string;        // Firma STIR raqami
  orgName?: string;       // Firma nomi
  userFullName?: string;  // E-IMZO egasi
}

/**
 * Step 2: Qoralama yaratish payload
 */
export interface CreateDraftPayload {
  instance: InstanceType;       // "FIRST"
  claim_type: ClaimType;       // "CIVIL"
  claim_kind: ClaimKind;       // "DECREE" (Sud buyrug'i) yoki "SUIT"
  court_id: string;            // Sud GUID (masalan Uchtepa)
  categories: string[];        // Kategoriya GUID'lari
}

export interface DraftCaseResponse {
  id: string;                  // draftId (UUID)
  case_number?: string;
  current_status: string;      // "DRAFT"
  created_at: string;
}

/**
 * Step 3: Tashkilot (Da'vogar / MMT) ma'lumotlari
 */
export interface OrganizationEntityData {
  name: string;                // To'liq yuridik nomi
  short_name?: string;         // Qisqa nomi
  tin: string | number;        // Firmaning 9 xonali STIR kodi
  director: string;            // Rahbari F.I.O
  address: string;             // Yuridik manzili
  bank_account: string;        // 20 xonali hisob raqami
  bank_mfo?: string;           // MFO kodi
  bank_id?: string;            // Bank GUID
  phone: string;               // Aloqa telefoni
  region_id?: string;          // Hudud GUID
  org_type?: string;           // "LOCAL_ORG"
}

/**
 * Step 4: Jismoniy shaxs (Javobgar / Qarzdor) ma'lumotlari
 */
export interface PersonEntityData {
  pinfl: string | number;      // 14 xonali JShShIR
  first_name: string;          // Ismi
  last_name: string;           // Familiyasi
  middle_name?: string;        // Otasining ismi
  passport_serial: string;     // Pasport seriyasi (AA)
  passport_number: string;     // Pasport raqami (1234567)
  birth_date?: string;         // Tug'ilgan sanasi (YYYY-MM-DD)
  address: string;             // Yashash manzili
  phone?: string;              // Telefon raqami
  citizenship?: string;        // "UZB_CITIZEN"
  gender?: 'MALE' | 'FEMALE';  // Jinsi
  region_id?: string;          // Yashash hududi GUID
}

/**
 * Umumiy Ishtirokchi Payload
 */
export interface AddParticipantPayload {
  draft_id: string;
  type: ParticipantType;       // CLAIMANT | DEFENDANT
  is_main: boolean;            // true
  entity_type: EntityType;     // ORGANIZATION | PERSON
  entity: {
    pinfl?: string | number | null;
    tin?: string | number | null;
    not_citizen?: boolean;
  };
  entity_details: OrganizationEntityData | PersonEntityData;
}

/**
 * Step 5: Boji va kvitansiya tekshirish
 */
export interface CalcDutiesPayload {
  instance: InstanceType;
  claim_type: ClaimType;
  claim_kind: ClaimKind;
  amount: number;              // Jami da'vo summasi (so'mda)
  withVCC: boolean;            // true
}

export interface CalcDutiesResponse {
  STATE?: number;              // Davlat boji
  POST?: number;               // Pochta xarajati (20,600)
  VCC?: number;                // Videokonferensiya to'lovi
  total?: number;
}

export interface FindReceiptPayload {
  receipt_number: string;      // 262... formatidagi kvitansiya raqami
  invoiceStatus?: string;
}

export interface ReceiptVerifyResponse {
  status: string;              // "PAID" | "CREATED"
  paid: boolean;
  amount: number;
  paidAt?: string;
  payerTin?: string;
}

/**
 * Step 6: Fayl yuklash
 */
export interface UploadedCabinetFile {
  fileId: string;              // Portal bergan GUID fayl identifikatori
  fileName: string;            // Fayl nomi
  fileType: string;            // Qaysi slotga tegishli ekanligi (CABINET_DOC_TYPES GUID)
  fileSize: number;
}

/**
 * Step 7: Da'voni yakuniy saqlash (Save Suit)
 */
export interface SaveSuitPayload {
  draft_id: string;
  court_id: string;
  category_id: string;
  claim_type: ClaimType;
  claim_kind: ClaimKind;
  amount_principal: number;    // Asosiy qarz summasi
  amount_interest: number;     // Foiz qarzi
  amount_penalty: number;      // Jarima / penya
  amount_total: number;        // Jami undiriladigan summa
  receipt_number?: string;     // Kvitansiya raqami
  uploaded_file_ids: string[]; // Yuklangan barcha fayl ID'lari
  claim_statement: string;     // Ariza qisqacha mazmuni / talabi
}

export interface SaveSuitResponse {
  ok: boolean;
  claim_id: string;            // Rasmiy shakllangan claim_id
  case_id?: string;
  status: string;              // "CREATED" yoki "PENDING_SIGN"
}

/**
 * Step 8: Yakuniy yuborish (Send to Court)
 */
export interface SendToCourtPayload {
  case_id: string;
  pkcs7_signature?: string;    // Tashkilot E-IMZO kaliti bilan qo'yilgan imzo
}

export interface SendToCourtResponse {
  ok: boolean;
  case_number: string;         // Sud ro'yxat raqami (masalan 2-1004-2604/38138)
  registry_number: string;     // Reyestr raqami (masalan 40940)
  status: string;              // "PENDING"
}
