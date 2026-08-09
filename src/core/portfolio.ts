// Pure helpers for mapping portfolio import rows to Loan fields (no DB, no I/O).

import { normalizeAddress } from './address';

export interface LoanInput {
  pinfl: string | null;
  passportSn: string | null;
  clientName: string | null;
  phone: string | null;
  postAddress: string | null;
  postAddressUz: string | null;
  regionName: string | null;
  branchCode: string | null;
  ldId: string | null;
  account: string | null;
  summKr: number | null;
  rate: number | null;
  dateToCr: Date | null;
  dateClose: Date | null;
  klassName: string | null;
  statusName: string | null;
  termType: string | null;
  debtPrincipal: number;
  debtTermInterest: number;
  debtOverduePrincipal: number;
  debtOverdueInterest: number;
  totalDebt: number;
  raw: Record<string, unknown>;
}

/** Coerce a raw cell value to a finite number, defaulting to 0 for '', null, undefined, NaN. */
function num(v: unknown): number {
  if (v === '' || v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Same as num() but returns null instead of 0 when there's no usable value (for nullable fields). */
function numOrNull(v: unknown): number | null {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  if (v === '' || v === null || v === undefined) return null;
  return String(v);
}

function toDate(v: unknown): Date | null {
  if (v === '' || v === null || v === undefined) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  // exceljs streaming (WorkbookReader) returns date-formatted cells as raw Excel serial NUMBERS,
  // not Date objects. Convert: Excel serial → Unix ms = (serial - 25569) * 86400000
  // (25569 = days from Excel's 1899-12-30 epoch to the Unix 1970-01-01 epoch). Without this,
  // `new Date(46204)` gave 1970-01-01 for every contract date.
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v <= 0) return null;
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function computeTotalDebt(r: Record<string, unknown>): number {
  return (
    num(r.summ_ost_ze) + num(r.summ_ostpr_ze) + num(r.sumproc_eqv) + num(r.sumnachpr_eqv)
  );
}

export function mapRowToLoan(header: string[], values: unknown[]): LoanInput {
  // Coerce undefined → null so JSON serialization keeps EVERY column (JSON.stringify drops
  // undefined-valued keys, which silently shrank a stored row from 106 columns to ~81). The user
  // requires the full row preserved, so every header column must survive as null when empty.
  const raw: Record<string, unknown> = {};
  header.forEach((h, i) => {
    raw[h] = values[i] ?? null;
  });

  return {
    pinfl: str(raw.pinfl),
    passportSn: str(raw.passport_sn),
    clientName: str(raw.client_name),
    phone: str(raw.phone_mobile),
    postAddress: str(raw.post_address),
    postAddressUz: normalizeAddress(str(raw.name), str(raw.distr_name), str(raw.post_address)) || null,
    regionName: str(raw.name),
    branchCode: str(raw.branch),
    ldId: str(raw.ld_id),
    account: str(raw.account),
    summKr: numOrNull(raw.summ_kr),
    rate: numOrNull(raw.rate),
    dateToCr: toDate(raw.date_to_cr),
    dateClose: toDate(raw.date_close),
    klassName: str(raw.klass_name),
    statusName: str(raw.status_name),
    termType: str(raw.term_type),
    debtPrincipal: num(raw.summ_ost_ze),
    debtTermInterest: num(raw.sumproc_eqv),
    debtOverduePrincipal: num(raw.summ_ostpr_ze),
    debtOverdueInterest: num(raw.sumnachpr_eqv),
    totalDebt: computeTotalDebt(raw),
    raw,
  };
}

export interface DateParts {
  day: number;
  month: number;
  year: number | null;
}

/** Extract a DD.MM[.YY[YY]] date from a filename. Returns null when no date-like pattern is found. */
export function parseDateParts(name: string): DateParts | null {
  const m = name.match(/(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year: number | null = null;
  if (m[3]) {
    year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  }
  return { day, month, year };
}
