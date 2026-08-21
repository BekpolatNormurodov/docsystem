// Pure two-stage filter + firm readiness — no I/O, unit-testable. This is the heart of the business
// rule the operator described:
//   A) total overdue (Лист1 «12405%+16377%») ≥ thresholdTotal (default 2 mln) → the debtor qualifies;
//   B) optional per-firm minimum — a firm-row is kept only when that firm's overdue ≥ perFirmMin.
// A firm is «ready» (full form) only when its code ∈ the 3 wired firms (Bright/Urban/Community); other
// firms are surfaced but blocked from sending until the operator confirms.
import { FIRMS } from '@/lib/firms';
import type { CandidatePerson, CandidatesFile, FilterOpts, FilterResult, FirmBucket } from './types';

/** Canonical firm code: trim + drop leading zeros so '06292' (Лист3) and 6292 (Лист2 numeric) unify. */
export const canonCode = (x: unknown): string => String(x ?? '').trim().replace(/^0+/, '') || '0';

/** The 3 firms with a complete letter form today (src/lib/firms.ts), by canonical code. */
export const READY_CODES = new Set(FIRMS.map((f) => canonCode(f.branchCode)));
export const isReadyFirm = (code: string): boolean => READY_CODES.has(canonCode(code));

export const DEFAULT_THRESHOLD = 2_000_000;

/** Does this person clear filter A (total overdue ≥ threshold)? */
export const passesTotal = (p: CandidatePerson, opts: FilterOpts): boolean =>
  Math.abs(p.totalOverdue) >= opts.thresholdTotal;

/**
 * Aggregate the file into per-firm buckets after applying filters A + B. A person contributes to a
 * firm bucket when they clear the total threshold AND their overdue at that firm clears perFirmMin.
 */
export function evaluate(file: CandidatesFile, opts: FilterOpts): FilterResult {
  const buckets = new Map<string, FirmBucket>();
  let qualified = 0;
  let readyPeople = 0;
  let unreadyPeople = 0;

  for (const p of file.people) {
    if (!passesTotal(p, opts)) continue;
    qualified += 1;

    let hasReady = false;
    let hasRow = false;
    for (const [rawCode, overdue] of Object.entries(p.perFirm)) {
      if (Math.abs(overdue) < opts.perFirmMin) continue;
      const code = canonCode(rawCode);
      hasRow = true;
      const ready = isReadyFirm(code);
      if (ready) hasReady = true;
      const b = buckets.get(code) ?? {
        code,
        name: file.firmNameByCode[code] ?? file.firmNameByCode[rawCode] ?? code,
        ready,
        personCount: 0,
        overdueSum: 0,
      };
      b.personCount += 1;
      b.overdueSum += Math.abs(overdue);
      buckets.set(code, b);
    }
    if (!hasRow) continue;
    if (hasReady) readyPeople += 1;
    else unreadyPeople += 1;
  }

  const firms = [...buckets.values()].sort(
    (a, b) => Number(b.ready) - Number(a.ready) || b.personCount - a.personCount,
  );

  return {
    qualifiedPeople: qualified,
    candidatePeople: file.people.length,
    firms,
    readyPersonCount: readyPeople,
    unreadyPersonCount: unreadyPeople,
  };
}
