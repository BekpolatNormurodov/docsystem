import { Role, CertStatus, WfAction } from './enums';

export const STATUS_LABELS: Record<CertStatus, string> = {
  [CertStatus.DRAFT]: 'Qoralama',
  [CertStatus.ADMIN_REVIEW]: "Admin ko'rigida",
  [CertStatus.DIRECTOR_REVIEW]: 'Rahbar imzosida',
  [CertStatus.SIGNED]: 'Imzolangan',
};

export const ROLE_LABELS: Record<Role, string> = {
  [Role.YURIST]: 'Yurist',
  [Role.ADMIN]: 'Admin',
  [Role.RAHBAR]: 'Rahbar',
};

/** Every value a maʼlumotnoma is written from. */
export type CertField =
  | 'firmId' | 'personPinfl' | 'personFullName' | 'personPassport'
  | 'passportIssuedBy' | 'passportIssuedAt' | 'contracts' | 'contractType'
  | 'loanAmount' | 'asOfDate' | 'asOfText' | 'issueDate' | 'infoRecipient'
  // «Savdo-sanoat palatasiga ariza» fields
  | 'courtName' | 'personAddress' | 'personPhone' | 'interestRate'
  | 'debtPrincipal' | 'debtTermInterest' | 'debtOverduePrincipal' | 'debtOverdueInterest'
  | 'debtTotal' | 'chamberSignerPosition' | 'chamberSignerName'
  | 'chamberExecutorName' | 'chamberExecutorPhone'
  // «Ишончнома» (power of attorney) fields
  | 'poaBankName' | 'poaContractDate' | 'poaContractNumber' | 'poaValidUntil';

/**
 * What each value is called when someone is told about it — on the document as a slot's name, and
 * in an API error when one is missing.
 *
 * One map, because those two used to be separate and the API's half was never written: it reported
 * the property name, so a yurist who left the name blank was told
 * «Maydon toʻldirilmagan: personFullName».
 */
export const CERT_FIELD_LABELS: Record<CertField, string> = {
  firmId: 'Firma',
  personPinfl: 'PINFL',
  personFullName: 'Mijozning F.I.SH.',
  personPassport: 'Passport raqami',
  passportIssuedBy: 'Passportni kim bergan',
  passportIssuedAt: 'Passport berilgan sana',
  contracts: 'Shartnomalar',
  contractType: 'Shartnoma turi',
  loanAmount: 'Kredit summasi',
  asOfDate: 'Holat sanasi',
  asOfText: 'Holat sanasi',
  issueDate: 'Maʼlumotnoma sanasi',
  infoRecipient: 'Maʼlumot uchun (tashkilot)',
  courtName: 'Sud nomi',
  personAddress: 'Qarzdor manzili',
  personPhone: 'Qarzdor telefoni',
  interestRate: 'Yillik foiz',
  debtPrincipal: 'Asosiy qarz qoldigʻi',
  debtTermInterest: 'Muddatli foizlar qarzdorligi',
  debtOverduePrincipal: 'Muddati oʻtgan qarz qarzdorligi',
  debtOverdueInterest: 'Muddati oʻtgan foizlar qarzdorligi',
  debtTotal: 'Jami qarzdorligi',
  chamberSignerPosition: 'Imzolovchi lavozimi',
  chamberSignerName: 'Imzolovchi',
  chamberExecutorName: 'Ijrochi',
  chamberExecutorPhone: 'Ijrochi telefoni',
  poaBankName: 'Bank (kim uchun undiradi)',
  poaContractDate: 'Xizmat shartnomasi sanasi',
  poaContractNumber: 'Shartnoma raqami',
  poaValidUntil: 'Amal muddati',
};

/** Document-type labels for the list badge/filter. */
export const DOC_TYPE_LABELS = {
  MALUMOTNOMA: 'Maʼlumotnoma',
  ARIZA: 'Savdo-sanoat palatasiga ariza',
  ISHONCHNOMA: 'Ishonchnoma',
} as const;

/** Short labels for the list chip, where the full ariza name is too long. */
export const DOC_TYPE_SHORT = {
  MALUMOTNOMA: 'Maʼlumotnoma',
  ARIZA: 'Ariza',
  ISHONCHNOMA: 'Ishonchnoma',
} as const;

/** Every document type, in the order the picker and the list filter present them. */
export const DOC_TYPES = ['MALUMOTNOMA', 'ARIZA', 'ISHONCHNOMA'] as const;

/**
 * Which of `fields` the body left empty, named in Uzbek — or null when none are.
 *
 * All of them at once rather than the first: one at a time makes the person save, read, fix, save
 * again and meet the next one.
 */
export function missingFieldsError(
  body: Record<string, unknown>,
  fields: readonly CertField[],
): string | null {
  const missing = fields.filter((f) => !body[f]).map((f) => CERT_FIELD_LABELS[f]);
  if (!missing.length) return null;
  return missing.length === 1
    ? `${missing[0]} toʻldirilmagan`
    : `Toʻldirilmagan maydonlar: ${missing.join(', ')}`;
}

export const ACTION_LABELS: Record<WfAction, string> = {
  [WfAction.SUBMIT]: 'Yuborildi',
  [WfAction.APPROVE]: 'Tasdiqlandi',
  [WfAction.RETURN]: 'Qaytarildi',
  [WfAction.SIGN]: 'Imzolandi',
  [WfAction.DELETE]: "O'chirildi (arxiv)",
  [WfAction.RESTORE]: 'Tiklandi',
};
