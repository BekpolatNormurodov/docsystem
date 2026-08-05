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

/** Maps a Loan + Firm + Settings row into the props `CourtArizaDocument` renders. */
export function loanToAriza(
  loan: ArizaLoan,
  firm: ArizaFirm,
  settings: Settings,
  reportDate: Date,
): LoanArizaProps {
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
    personFullName: loan.clientName ?? '',
    personPinfl: loan.pinfl ?? '',
    personAddress: loan.postAddress ?? '',
    personPhone: loan.phone ?? '',
    contracts: [{ number: String(loan.ldId ?? ''), date: loan.dateToCr as Date }],
    contractType: settings.contractType,
    interestRate: String(loan.rate),
    loanAmount: String(loan.summKr),
    asOfDate: reportDate,
    debtPrincipal: String(loan.debtPrincipal),
    debtTermInterest: String(loan.debtTermInterest),
    debtOverduePrincipal: String(loan.debtOverduePrincipal),
    debtOverdueInterest: String(loan.debtOverdueInterest),
    debtTotal: String(loan.totalDebt),
    chamberSignerPosition: settings.signerPosition,
    chamberSignerName: settings.signerName,
    chamberExecutorName: settings.executorName,
    chamberExecutorPhone: settings.executorPhone,
    firm: arizaFirm,
  };
}
