// Uzbek labels for audit actions — pure, so both the server page and the client
// filter bar import it without pulling in prisma.

export const ACTION_LABELS: Record<string, string> = {
  LOGIN: 'Kirish',
  LOGOUT: 'Chiqish',
  STAGE_ADVANCE: 'Bosqich o‘tkazildi',
  TALABNOMA_SEND: 'Talabnoma jo‘natildi',
  TALABNOMA_GEN: 'Talabnoma tayyorlandi',
  ARIZA_GEN: 'Ariza yaratildi',
  PALATA_SCAN: 'Palata skani',
  INVOICE_GEN: 'Invoice yaratildi',
  INVOICE_BATCH: 'Invoice paketi',
  FARMOYISH: 'Farmoyish',
  PACKET_GEN: 'Paket yaratildi',
  COURT_SUBMIT: 'Sudga topshirildi',
  MIB: 'MIB ijro',
  IMPORT: 'Import',
  EXPORT: 'Eksport',
  SYNC: 'Sinxronlash',
  SNAPSHOT_DELETE: 'Snapshot o‘chirildi',
  FIRM_EDIT: 'Firma tahrirlandi',
  USER_CREATE: 'Foydalanuvchi qo‘shildi',
  USER_UPDATE: 'Foydalanuvchi tahrirlandi',
  USER_DELETE: 'Foydalanuvchi o‘chirildi',
  PASSWORD_CHANGE: 'Parol o‘zgartirildi',
  CONNECT: 'Ulanish',
};

export const actionLabel = (a: string) => ACTION_LABELS[a] ?? a;

// Category drives the color + icon of each action in the Jurnal. `danger` is a
// deliberate override for destructive actions regardless of their area.
export type ActionCat = 'auth' | 'pipeline' | 'docs' | 'data' | 'people' | 'connect' | 'danger';

export const ACTION_CAT: Record<string, ActionCat> = {
  LOGIN: 'auth',
  LOGOUT: 'auth',
  STAGE_ADVANCE: 'pipeline',
  MIB: 'pipeline',
  COURT_SUBMIT: 'pipeline',
  TALABNOMA_SEND: 'docs',
  TALABNOMA_GEN: 'docs',
  ARIZA_GEN: 'docs',
  INVOICE_GEN: 'docs',
  INVOICE_BATCH: 'docs',
  FARMOYISH: 'docs',
  PACKET_GEN: 'docs',
  PALATA_SCAN: 'docs',
  IMPORT: 'data',
  EXPORT: 'data',
  SYNC: 'data',
  SNAPSHOT_DELETE: 'danger',
  FIRM_EDIT: 'people',
  USER_CREATE: 'people',
  USER_UPDATE: 'people',
  USER_DELETE: 'danger',
  PASSWORD_CHANGE: 'people',
  CONNECT: 'connect',
};

export const actionCat = (a: string): ActionCat => ACTION_CAT[a] ?? 'data';

/** Actions offered in the Jurnal filter dropdown, in a sensible reading order. */
export const FILTERABLE_ACTIONS: string[] = [
  'STAGE_ADVANCE', 'TALABNOMA_SEND', 'ARIZA_GEN', 'INVOICE_GEN', 'INVOICE_BATCH',
  'PACKET_GEN', 'COURT_SUBMIT', 'MIB', 'IMPORT', 'SYNC', 'FIRM_EDIT',
  'USER_CREATE', 'USER_UPDATE', 'USER_DELETE', 'LOGIN', 'LOGOUT', 'CONNECT',
];
