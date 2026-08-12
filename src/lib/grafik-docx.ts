// Kredit toʻlash grafigi (payment schedule) DOCX — the 5th court attachment.
// The portfolio Excel carries no month-by-month schedule (only principal, rate,
// disbursement→maturity dates), so this COMPUTES a standard ANNUITY (equal
// monthly payment) schedule per contract. If a firm's contracts use the
// differentiated (declining) method instead, switch `annuity` → `differentiated`.
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, BorderStyle, WidthType, AlignmentType, VerticalAlign } from 'docx';

const FONT = 'Times New Roman';
// 2-decimal, space-grouped — matches the firm's real grafik («2 000 000,00», «79 890,41»).
const money = (n: number) => new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const dmy = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;

export interface GrafikLoan {
  ldId: string | null;
  summKr: unknown;        // principal
  rate: unknown;          // annual %
  dateToCr: Date | null;  // disbursement
  dateClose: Date | null; // credit-line expiry (NOT the real term — see loanMaturity)
  raw?: unknown;          // full portfolio row — carries `date_actu_close` (the real close)
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export function monthsBetween(a: Date, b: Date): number {
  const m = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  // Cap at 50 years — a corrupt maturity date (year 2999, swapped fields) must not
  // drive a multi-thousand-row table that OOMs the server.
  return Math.min(600, Math.max(1, m));
}

/** Excel serial number → UTC Date. Excel's epoch is 1899-12-30 (the -1 offset absorbs
 *  the fictitious 1900-02-29). Returns null for a missing / non-positive serial. */
export function excelSerialToDate(serial: unknown): Date | null {
  const n = Number(serial);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(Date.UTC(1899, 11, 30) + n * 86400000);
}

/** The REAL micro-loan maturity: `date_actu_close` from the raw portfolio row — the
 *  actual planned close that reflects the true product term (12 / 24 / 36 months).
 *  `dateClose` is the revolving credit-line's far-off expiry (~72mo for the
 *  «3-Долгосрочные» class) and must NOT drive the schedule/term. Falls back to
 *  `dateClose` only when the actual-close serial is absent (≈0.15% of loans). */
export function loanMaturity(loan: { dateClose: Date | null; raw?: unknown }): Date | null {
  const raw = (loan?.raw ?? null) as Record<string, unknown> | null;
  const actu = raw ? excelSerialToDate(raw['date_actu_close']) : null;
  return actu ?? loan.dateClose;
}

/** Whole-month installment count between disbursement and maturity, day-aware so a
 *  365-day loan is exactly 12 (not 11 or 13 from a naive month-diff). Clamped to
 *  [1, 600]. 30.4375 = 365.25/12, the mean calendar month. */
export function termMonths(start: Date, maturity: Date): number {
  const days = (maturity.getTime() - start.getTime()) / 86400000;
  return Math.min(600, Math.max(1, Math.round(days / 30.4375)));
}

// Uzbek fixed public holidays (MM-DD) — a payment landing on one shifts to the next business day.
const UZ_HOLIDAYS = new Set(['01-01', '01-14', '03-08', '03-21', '05-09', '09-01', '10-01', '12-08']);
/** Nudge a payment date off weekends/holidays to the next business day (matches the firm's grafik:
 *  05.07→06.07, 05.09→07.09, 05.12→07.12 in 2026). */
function nextBusinessDay(ms: number): number {
  for (let k = 0; k < 8; k++) {
    const d = new Date(ms), dow = d.getUTCDay();
    const md = `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    if (dow === 0 || dow === 6 || UZ_HOLIDAYS.has(md)) { ms += 86400000; continue; }
    break;
  }
  return ms;
}

export interface ScheduleRow { n: number; date: Date; balance: number; principal: number; interest: number; payment: number }
export interface LoanScheduleResult { rows: ScheduleRow[]; total: number; payment: number; totalInterest: number }

/**
 * The firm's REAL «график погашения микрозайма», reproduced to the tiyin (verified against
 * договор 604264498 and the ABDUGʻANIYEV oferta):
 *  - a 1-month INTEREST-ONLY grace period (the first installment pays only interest);
 *  - a level annuity payment over the remaining (term − grace) installments, sized with
 *    monthlyRate = annual/12 (M = P·r / (1 − (1+r)^−(term−grace)));
 *  - interest accrued on the ACTUAL days of each period at a 365-day basis (54%·days/365);
 *  - installments on the 5th of each month, weekend/holiday → next business day;
 *  - the final installment clears the outstanding balance exactly.
 * `total` is the «Микроқарзнинг тўлиқ қиймати» (principal + all interest).
 */
export function loanSchedule(principal: number, annualRatePct: number, disburse: Date, term: number, graceMonths = 1): LoanScheduleResult {
  const P = Math.round(principal);
  const r = annualRatePct / 100, mr = r / 12;
  const n = Math.min(600, Math.max(1, Math.round(term)));
  const nAmort = Math.max(1, n - graceMonths);
  const M = mr > 0 ? (P * mr) / (1 - Math.pow(1 + mr, -nAmort)) : P / nAmort;
  const y = disburse.getUTCFullYear(), mo = disburse.getUTCMonth();
  const rows: ScheduleRow[] = [];
  let bal = P, prev = disburse.getTime(), total = 0, totalInterest = 0;
  for (let i = 0; i < n; i++) {
    const due = nextBusinessDay(Date.UTC(y, mo + 1 + i, 5));
    const days = Math.round((due - prev) / 86400000);
    const interest = (bal * r * days) / 365;
    let principalPaid: number, payment: number;
    if (i < graceMonths) { principalPaid = 0; payment = interest; }        // льготный: interest only
    else if (i === n - 1) { principalPaid = bal; payment = bal + interest; } // final: clear the balance
    else { payment = M; principalPaid = M - interest; }
    rows.push({ n: i + 1, date: new Date(due), balance: bal, principal: principalPaid, interest, payment });
    bal -= principalPaid; total += payment; totalInterest += interest; prev = due;
  }
  return { rows, total, payment: M, totalInterest };
}
export function addMonthsUTC(d: Date, n: number): Date {
  const day = d.getUTCDate();
  const r = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  // Clamp the day to the target month's length so 31.01 → 28/29.02, not 03.03.
  const lastDay = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(day, lastDay));
  return r;
}

/** A loan can produce a real payment schedule only with a positive principal AND both
 *  dates present AND in chronological order (disbursement strictly before maturity).
 *  A reversed/corrupt date pair must be excluded — never emitted as a bogus 1-month
 *  schedule whose maturity precedes disbursement on a document filed with the court. */
export function isSchedulableLoan(l: { summKr: unknown; dateToCr: Date | null; dateClose: Date | null; raw?: unknown }): boolean {
  const mat = loanMaturity(l);
  return Number(l.summKr) > 0 && !!l.dateToCr && !!mat && mat > l.dateToCr;
}

export interface Installment { n: number; date: Date; payment: number; principal: number; interest: number; balance: number }

/** Standard annuity schedule: equal monthly payment, split into interest (on the
 *  outstanding balance) + principal, with the balance declining to exactly 0.
 *  Works in whole soʻm so the DISPLAYED rows sum exactly (no rounding drift). */
export function annuity(principal: number, annualRatePct: number, months: number, start: Date): Installment[] {
  const r = annualRatePct / 100 / 12;
  const M = Math.round(r > 0 ? (principal * r) / (1 - Math.pow(1 + r, -months)) : principal / months);
  const rows: Installment[] = [];
  let bal = Math.round(principal);
  for (let i = 1; i <= months; i++) {
    const interest = Math.round(bal * r);
    // last row (or an overshoot) clears the remaining balance exactly, so the
    // principal column sums to the loan amount and the balance ends at 0.
    let principalPaid = i === months || M - interest > bal ? bal : M - interest;
    if (principalPaid < 0) principalPaid = 0;
    bal -= principalPaid;
    rows.push({ n: i, date: addMonthsUTC(start, i), payment: principalPaid + interest, principal: principalPaid, interest, balance: bal });
  }
  return rows;
}

const border = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
const CELL = { top: border, bottom: border, left: border, right: border };
function cell(text: string, opts: { bold?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; w?: number } = {}) {
  return new TableCell({
    borders: CELL, width: opts.w ? { size: opts.w, type: WidthType.PERCENTAGE } : undefined, verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({ alignment: opts.align ?? AlignmentType.CENTER, spacing: { before: 20, after: 20 }, children: [new TextRun({ text, bold: opts.bold, font: FONT, size: 18 })] })],
  });
}

export async function buildGrafikDocx(loans: GrafikLoan[], clientName: string | null, firmName: string): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: 'KREDIT TOʻLASH GRAFIGI', bold: true, size: 28, font: FONT })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new TextRun({ text: firmName, bold: true, size: 22, font: FONT })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [new TextRun({ text: `Qarzdor: ${clientName ?? '—'}`, size: 22, font: FONT })] }),
  ];

  for (const l of loans) {
    const principal = Math.round(num(l.summKr));
    const rate = num(l.rate);
    // Defense-in-depth: even if a caller skips the isSchedulableLoan() filter, the
    // builder itself never renders a schedule with a non-positive amount or a
    // missing / reversed date pair (the `<=` also rejects equal dates → 0 months).
    const mat = loanMaturity(l);
    if (principal <= 0 || !l.dateToCr || !mat || mat <= l.dateToCr) continue;
    const months = termMonths(l.dateToCr, mat);
    // Same engine as the oferta «тўлиқ қиймати» — the firm's real grafik (grace + annuity(n−1)
    // + daily 365 interest + business-day 5th installments), so the two documents agree exactly.
    const sched = loanSchedule(principal, rate, l.dateToCr, months);

    children.push(new Paragraph({
      spacing: { before: 160, after: 60 },
      children: [new TextRun({ text: `Shartnoma № ${l.ldId ?? '—'} — ${money(principal)} soʻm, yillik ${rate}%, ${months} oy (${dmy(l.dateToCr)} — ${dmy(mat)})`, bold: true, size: 20, font: FONT })],
    }));

    // Column order mirrors the firm's «график погашения»: №, sana, qoldiq (opening), asosiy, foiz, jami.
    const header = new TableRow({
      tableHeader: true,
      children: [
        cell('№', { bold: true, w: 6 }), cell('Toʻlov sanasi', { bold: true, w: 17 }), cell('Qoldiq', { bold: true, w: 21 }),
        cell('Asosiy qarz', { bold: true, w: 20 }), cell('Foizlar', { bold: true, w: 18 }), cell('Jami', { bold: true, w: 18 }),
      ],
    });
    const rows = sched.rows.map((s) => new TableRow({
      children: [
        cell(String(s.n)), cell(dmy(s.date)), cell(money(s.balance), { align: AlignmentType.RIGHT }),
        cell(money(s.principal), { align: AlignmentType.RIGHT }), cell(money(s.interest), { align: AlignmentType.RIGHT }), cell(money(s.payment), { align: AlignmentType.RIGHT }),
      ],
    }));
    const totalRow = new TableRow({
      children: [
        cell('', {}), cell('Jami', { bold: true }), cell('', {}),
        cell(money(principal), { bold: true, align: AlignmentType.RIGHT }), cell(money(sched.totalInterest), { bold: true, align: AlignmentType.RIGHT }), cell(money(sched.total), { bold: true, align: AlignmentType.RIGHT }),
      ],
    });
    children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [header, ...rows, totalRow] }));
  }

  const doc = new Document({ styles: { default: { document: { run: { font: FONT, size: 20 } } } }, sections: [{ children }] });
  return Packer.toBuffer(doc);
}
