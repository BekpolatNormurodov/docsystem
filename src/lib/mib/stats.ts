// Aggregate a report's clients+cases into monitoring statistics (status breakdown, per-firm case
// counts + debt sums). Money fields are space-grouped strings on mib.uz → parse before summing.
import type { MibCase, MibClient } from '@prisma/client';

export const parseMoney = (s: string | null | undefined): number => {
  if (!s) return 0;
  const n = Number(String(s).replace(/[^\d.,-]/g, '').replace(/\s+/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

export interface MibStats {
  total: number;
  status: Record<string, number>; // PENDING/RUNNING/DONE/CLEAN/FAILED
  withCases: number; // clients that have ≥1 execution case
  totalCases: number;
  detailedCases: number; // cases with Step 19 detail fetched
  firms: { name: string; inn: string; cases: number; clients: number; remainingDebt: number }[];
  totalRemainingDebt: number;
}

export function computeStats(clients: (MibClient & { cases: MibCase[] })[]): MibStats {
  const status: Record<string, number> = {};
  let withCases = 0;
  let totalCases = 0;
  let detailedCases = 0;
  let totalRemainingDebt = 0;
  const firmMap = new Map<string, { name: string; inn: string; cases: number; clients: Set<number>; remainingDebt: number }>();

  for (const cl of clients) {
    status[cl.status] = (status[cl.status] ?? 0) + 1;
    if (cl.cases.length) withCases += 1;
    for (const c of cl.cases) {
      totalCases += 1;
      if (c.detailFetchedAt) detailedCases += 1;
      if (c.isTargetFirm && c.firmName) {
        const key = `${c.firmInn}|${c.firmName}`;
        const f = firmMap.get(key) ?? { name: c.firmName, inn: c.firmInn ?? '', cases: 0, clients: new Set<number>(), remainingDebt: 0 };
        f.cases += 1;
        f.clients.add(cl.id);
        f.remainingDebt += parseMoney(c.remainingDebt);
        firmMap.set(key, f);
      }
      totalRemainingDebt += parseMoney(c.remainingDebt);
    }
  }

  const firms = [...firmMap.values()]
    .map((f) => ({ name: f.name, inn: f.inn, cases: f.cases, clients: f.clients.size, remainingDebt: f.remainingDebt }))
    .sort((a, b) => b.cases - a.cases);

  return { total: clients.length, status, withCases, totalCases, detailedCases, firms, totalRemainingDebt };
}
