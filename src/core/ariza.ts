import type { CourtArizaDocumentProps } from '@/ui/CourtArizaDocument';
import type { CertFirm } from '@/ui/firm-types';
import type { Settings } from '@/lib/settings';

/** The Loan fields the ariza mapping reads. Amounts are Decimal at runtime (Decimal.toString via String()). */
export interface ArizaLoan {
  clientName: string | null;
  postAddress: string | null;
  postAddressUz: string | null;
  pinfl: string | null;
  phone: string | null;
  ldId: string | null;
  dateToCr: Date | null;
  rate: unknown;
  summKr: unknown;
  debtPrincipal: unknown;
  debtTermInterest: unknown;
  debtOverduePrincipal: unknown;
  debtOverdueInterest: unknown;
  totalDebt: unknown;
}

/** The Firm fields the ariza's «undiruvchi» block reads. */
export interface ArizaFirm {
  shortName: string;
  legalName: string | null;
  address: string | null;
  bankAccount: string | null;
  mfo: string | null;
  stir: string | null;
}

export type LoanArizaProps = Omit<CourtArizaDocumentProps, 'edit' | 'qrDataUrl'>;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
/** Sum a money field across loans, rounded to 2 decimals (avoids float artifacts). */
const sum2 = (loans: ArizaLoan[], pick: (l: ArizaLoan) => unknown): string =>
  String(Math.round(loans.reduce((s, l) => s + num(pick(l)), 0) * 100) / 100);

/**
 * Maps a client's loans AT ONE FIRM into a single ariza: all contracts are listed together and the
 * debt (loan amount + the four components + total) is SUMMED across them — one court petition per
 * (client × firm), not per contract.
 */
export function loansToAriza(
  loans: ArizaLoan[],
  firm: ArizaFirm,
  settings: Settings,
  reportDate: Date,
  courtName?: string, // firmaning asosiy sudi (court-routing); berilmasa settings.courtName
): LoanArizaProps {
  const first = loans[0]!;
  // The contracts in one ariza can carry DIFFERENT annual rates (foiz). Stating
  // only first.rate misstates the others, so: one value when they all agree, else
  // the actual range "min–max" (e.g. "53–62"). Null/0 rates are ignored; if none
  // remain the field is blank (never "null"/"NaN" in a filed petition).
  const rates = [...new Set(loans.map((l) => num(l.rate)).filter((r) => r > 0))].sort((a, b) => a - b);
  const interestRate = rates.length === 0 ? '' : rates.length === 1 ? String(rates[0]) : `${rates[0]}–${rates[rates.length - 1]}`;
  // Debt breakdown (each rounded once) — the total is derived from these so the four
  // line items always reconcile to «Jami» and the demanded amount.
  const debtPrincipal = sum2(loans, (l) => l.debtPrincipal);
  const debtTermInterest = sum2(loans, (l) => l.debtTermInterest);
  const debtOverduePrincipal = sum2(loans, (l) => l.debtOverduePrincipal);
  const debtOverdueInterest = sum2(loans, (l) => l.debtOverdueInterest);
  const arizaFirm: CertFirm = {
    name: firm.shortName,
    arizaName: firm.legalName || firm.shortName,
    arizaAddress: firm.address,
    bankAccount: firm.bankAccount,
    mfo: firm.mfo,
    stir: firm.stir,
  };

  return {
    number: '',
    issueDate: reportDate,
    courtName: courtName || settings.courtName,
    personFullName: first.clientName ?? '',
    personPinfl: first.pinfl ?? '',
    personAddress: first.postAddressUz || first.postAddress || '',
    personPhone: first.phone ?? '',
    contracts: loans.map((l) => ({ number: String(l.ldId ?? ''), date: l.dateToCr as Date })),
    contractType: settings.contractType,
    interestRate,
    loanAmount: sum2(loans, (l) => l.summKr),
    asOfDate: reportDate,
    debtPrincipal,
    debtTermInterest,
    debtOverduePrincipal,
    debtOverdueInterest,
    // Derive the total from the ALREADY-ROUNDED components so the printed
    // breakdown reconciles exactly to «Jami» and to the SOʻRAYMIZ demand (else
    // independent rounding can leave line items that don't add up to the total).
    debtTotal: String(Math.round((num(debtPrincipal) + num(debtTermInterest) + num(debtOverduePrincipal) + num(debtOverdueInterest)) * 100) / 100),
    chamberSignerPosition: settings.signerPosition,
    chamberSignerName: settings.signerName,
    chamberExecutorName: settings.executorName,
    chamberExecutorPhone: settings.executorPhone,
    firm: arizaFirm,
  };
}

/** Single-loan convenience (one contract, its own debt). */
export function loanToAriza(loan: ArizaLoan, firm: ArizaFirm, settings: Settings, reportDate: Date): LoanArizaProps {
  return loansToAriza([loan], firm, settings, reportDate);
}
