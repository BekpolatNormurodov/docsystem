import type { CourtArizaDocumentProps } from '@/ui/CourtArizaDocument';
import type { CertFirm } from '@/ui/firm-types';
import type { Settings } from '@/lib/settings';

/** The Loan fields the ariza mapping reads. Amounts are Decimal at runtime (Decimal.toString via String()). */
export interface ArizaLoan {
  clientName: string | null;
  postAddress: string | null;
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
): LoanArizaProps {
  const first = loans[0]!;
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
    courtName: settings.courtName,
    personFullName: first.clientName ?? '',
    personPinfl: first.pinfl ?? '',
    personAddress: first.postAddress ?? '',
    personPhone: first.phone ?? '',
    contracts: loans.map((l) => ({ number: String(l.ldId ?? ''), date: l.dateToCr as Date })),
    contractType: settings.contractType,
    interestRate: String(first.rate),
    loanAmount: sum2(loans, (l) => l.summKr),
    asOfDate: reportDate,
    debtPrincipal: sum2(loans, (l) => l.debtPrincipal),
    debtTermInterest: sum2(loans, (l) => l.debtTermInterest),
    debtOverduePrincipal: sum2(loans, (l) => l.debtOverduePrincipal),
    debtOverdueInterest: sum2(loans, (l) => l.debtOverdueInterest),
    debtTotal: sum2(loans, (l) => l.totalDebt),
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
