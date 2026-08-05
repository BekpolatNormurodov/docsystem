// Pure month/day helpers for the Kalendar pages. UTC-based: date-only values are
// stored at UTC midnight, so local-time math would shift days.

/** Date -> 'YYYY-MM-DD' (UTC). */
export function isoDay(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Date -> 'YYYY-MM' (UTC). */
export function isoMonth(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Half-open [gte, lt) range covering a 'YYYY-MM'. */
export function monthRange(month: string): { gte: Date; lt: Date } {
  const [y, m] = month.split('-').map(Number);
  return { gte: new Date(Date.UTC(y!, m! - 1, 1)), lt: new Date(Date.UTC(y!, m!, 1)) };
}

/** Shift a 'YYYY-MM' by n months. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + delta, 1));
  return isoMonth(d);
}

/** True when 'YYYY-MM' is well formed. */
export function isValidMonth(month: string | undefined): month is string {
  return !!month && /^\d{4}-\d{2}$/.test(month);
}

/** True when 'YYYY-MM-DD' is well formed *and* a real date (rejects 2026-02-30). */
export function isValidDay(day: string | undefined): day is string {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const d = new Date(`${day}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && isoDay(d) === day;
}

export const UZ_MONTHS_LAT = [
  'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
  'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr',
] as const;

/** Monday-first weekday heads — Sh/Ya are the weekend. */
export const WEEKDAYS_LAT = ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya'] as const;

/**
 * Monday-first cell layout for a 'YYYY-MM'. Leading blanks pad to the first weekday and
 * trailing blanks fill the last week, so the result is always a whole number of rows.
 */
export function monthGrid(month: string): (number | null)[] {
  const [y, m] = month.split('-').map(Number);
  const startWd = (new Date(Date.UTC(y!, m! - 1, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(y!, m!, 0)).getUTCDate();

  const cells: (number | null)[] = Array(startWd).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/**
 * Same day-of-month in another month, clamped to that month's length so browsing from the
 * 31st into a shorter month lands on its last day instead of rolling into the next one.
 */
export function sameDayInMonth(month: string, dayOfMonth: number): string {
  const [y, m] = month.split('-').map(Number);
  const len = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  const d = Math.min(Math.max(dayOfMonth, 1), len);
  return `${month}-${String(d).padStart(2, '0')}`;
}

/** 'YYYY-MM-DD' -> 'DD.MM.YYYY'. Unparseable in, empty out. */
export function isoToDmy(iso: string): string {
  if (!isValidDay(iso)) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/** 'DD.MM.YYYY' -> 'YYYY-MM-DD'. Incomplete or unreal in, empty out. */
export function dmyToIso(v: string): string {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(v.trim());
  if (!m) return '';
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  return isValidDay(iso) ? iso : '';
}

/** Group {date,status} rows into the Calendar's per-day shape. */
export function groupByDay(rows: { date: Date; status: string }[]): Record<string, { total: number; counts: Record<string, number> }> {
  const out: Record<string, { total: number; counts: Record<string, number> }> = {};
  for (const r of rows) {
    const k = isoDay(r.date);
    const cell = (out[k] ??= { total: 0, counts: {} });
    cell.total += 1;
    cell.counts[r.status] = (cell.counts[r.status] ?? 0) + 1;
  }
  return out;
}
