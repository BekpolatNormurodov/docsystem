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

/** Unwrap an exceljs streaming-reader cell value. Rich-text / formula / hyperlink
 *  cells arrive as OBJECTS whose String() is "[object Object]" — so a debt in a
 *  formula cell would read NaN→0 (understated on a court doc) and a rich-text name
 *  would become literal "[object Object]". Return the underlying primitive. Mirrors
 *  parse-exclusion.ts's cellStr (which was already hardened for the same reason). */
function unwrapCell(v: unknown): unknown {
  if (v !== null && typeof v === 'object') {
    const o = v as any;
    if (Array.isArray(o.richText)) return o.richText.map((r: any) => r?.text ?? '').join('');
    if (o.result !== undefined && o.result !== null) return o.result; // formula → computed value
    if (o.text !== undefined && o.text !== null && !(v instanceof Date)) return o.text; // hyperlink → text
  }
  return v; // primitives + Date pass through (Date handled by toDate)
}

/** Parse a cell to a finite number, tolerating locale-formatted TEXT cells
 *  ("12 345,67", "12'345.67") so a text-typed debt column isn't silently read as
 *  NaN→0, which would understate the debt on a court document. null if unusable. */
function parseNum(v: unknown): number | null {
  v = unwrapCell(v);
  if (v === '' || v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/[\s ']/g, ''); // strip spaces/nbsp/apostrophe thousands
  if (s === '') return null;
  if (s.includes(',') && s.includes('.')) {
    // both present → the LAST separator is the decimal one
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = s.replace(',', '.'); // Uzbek/Russian decimal comma
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Coerce a raw cell value to a finite number, defaulting to 0 for '', null, undefined, NaN. */
function num(v: unknown): number {
  return parseNum(v) ?? 0;
}

/** Same as num() but returns null instead of 0 when there's no usable value (for nullable fields). */
function numOrNull(v: unknown): number | null {
  return parseNum(v);
}

function str(v: unknown): string | null {
  v = unwrapCell(v);
  if (v === '' || v === null || v === undefined) return null;
  // Trim so a whitespace-padded PINFL matches the (trimmed) exclusion set — else an
  // intentionally-excluded problem client escapes exclusion and gets sued.
  const s = String(v).trim();
  return s === '' ? null : s;
}

function toDate(v: unknown): Date | null {
  v = unwrapCell(v);
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
  // Anchor on non-digit boundaries so a longer run (e.g. a 4-digit year) can't
  // feed the wrong groups, and reject impossible day/month.
  const m = name.match(/(?<!\d)(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?(?!\d)/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  let year: number | null = null;
  if (m[3]) {
    year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  }
  return { day, month, year };
}
