import type { Firm } from '@prisma/client';

export const COURT_DEFAULTS = {
  courtType: 'Фуқаролик ишлари бўйича',
  courtRegion: 'Тошкент шаҳар',
  court: 'Фуқаролик ишлари бўйича Учтепа туманлараро суди',
} as const;

export const INVOICE_DEFAULTS = {
  count: 1,
  paymentType: 'Почта харажатлари',
  amount: 20600,
  ...COURT_DEFAULTS,
} as const;

/** Billing «To'lov turi» dropdown — uchta statik variant (kirill, saytdagidek). */
export const PAYMENT_TYPES: { value: string; label: string }[] = [
  { value: 'Давлат божи', label: 'Давлат божи' },
  { value: 'Почта харажатлари', label: 'Почта харажатлари' },
  { value: 'Видеоконференцалоқа харажатлари', label: 'Видеоконференцалоқа харажатлари' },
];

export interface InvoiceSelections {
  paymentType: string;
  amount: number;
}

export interface InvoiceFormData {
  orgName: string;
  stir: string;
  region: string;
  district: string;
  addressLine: string;
  courtType: string;
  courtRegion: string;
  court: string;
  paymentType: string;
  amount: number;
}

/** Firm + foydalanuvchi tanlovidan billing formasi uchun to'liq maydonlar to'plamini yig'adi. */
export function buildInvoiceForm(firm: Firm, sel: InvoiceSelections): InvoiceFormData {
  return {
    orgName: firm.shortName?.trim() || firm.legalName?.trim() || '',
    stir: firm.stir ?? '',
    region: firm.region ?? '',
    district: firm.district ?? '',
    addressLine: firm.addressLine ?? '',
    courtType: COURT_DEFAULTS.courtType,
    courtRegion: COURT_DEFAULTS.courtRegion,
    court: COURT_DEFAULTS.court,
    paymentType: sel.paymentType,
    amount: sel.amount,
  };
}
