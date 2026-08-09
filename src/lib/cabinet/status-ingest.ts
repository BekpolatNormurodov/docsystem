// Pull all cabinet.sud.uz cases for a firm, match each to a portfolio client by
// name (pinfl), and persist real statuses to ClientCaseStatus. Cabinet hides the
// defendant PINFL, so linking is by normalised name against the full portfolio
// (diacritics stripped -> ~100% coverage). Reuses the stored session (no signing).
import { prisma } from '../db';
import { cabinetFetch } from './api';
import type { CabinetSession } from './oneid';

// Normalise a name for matching: strip diacritics (Karakalpak Í/Ú…), unify
// apostrophes, fold X->H, drop non-letters. Latin + Cyrillic safe.
export function normName(s: string): string {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[‘’`ʻ']/g, '').replace(/X/g, 'H')
    .replace(/[^A-ZА-Я ]/g, '').replace(/\s+/g, ' ').trim();
}

const STATUS_UZ: Record<string, string> = {
  DRAFT: 'Qoralama', CREATED: 'Yaratilgan', PENDING: 'Kutilmoqda',
  IN_PROCESS: 'Ko‘rib chiqilmoqda', DECIDED: 'Qaror chiqarilgan',
  FINISHED: 'Yakunlangan', DECLINED: 'Rad etilgan', RETURNED: 'Qaytarilgan',
};

const CATS = ['civil', 'economic', 'administrative', 'conflict'] as const;
const LISTS = ['first-materials', 'first-non-material-cases', 'all-cases'] as const;
const asArray = (j: any): any[] => (Array.isArray(j) ? j : j?.content ?? j?.data ?? []);
const toDate = (v: any) => { const d = v ? new Date(v) : null; return d && !isNaN(d.getTime()) ? d : null; };

export interface IngestResult {
  branchCode: string; totalCases: number; matched: number; unmatched: number;
  byStatus: Record<string, number>;
}

// Build norm(name) -> pinfl index from the firm's full latest-snapshot portfolio.
async function buildNameIndex(branchCode: string, snapshotId: number) {
  const loans = await prisma.loan.findMany({
    where: { snapshotId, branchCode }, select: { clientName: true, pinfl: true },
  });
  const idx = new Map<string, string>();
  for (const l of loans) if (l.clientName && l.pinfl) idx.set(normName(l.clientName), l.pinfl);
  return idx;
}

export async function ingestCabinetStatuses(
  session: CabinetSession, branchCode: string,
): Promise<IngestResult> {
  const snap = await prisma.snapshot.findFirst({ orderBy: { reportDate: 'desc' } });
  const nameIdx = await buildNameIndex(branchCode, snap!.id);

  // Collect one row per distinct cabinet case (dedupe by caseNumber).
  const seen = new Set<string>();
  const rows: any[] = [];
  const byStatus: Record<string, number> = {};
  let matched = 0;

  for (const cat of CATS) for (const list of LISTS) {
    const r = await cabinetFetch(session, `/api/cabinet/case/${cat}/${list}`);
    if (r.status !== 200) continue;
    for (const c of asArray(r.json)) {
      const caseNumber = c.case_number ?? c.case_id ?? c.claim_id;
      if (!caseNumber || seen.has(caseNumber)) continue;
      seen.add(caseNumber);
      const def = (c.participants || []).find((p: any) => p.type === 'DEFENDANT');
      const clientName = def?.name ?? '';
      const pinfl = nameIdx.get(normName(clientName)) ?? null;
      if (pinfl) matched++;
      const status = c.current_status ?? c.status ?? 'UNKNOWN';
      byStatus[status] = (byStatus[status] ?? 0) + 1;
      rows.push({
        branchCode, pinfl, clientName, source: 'CABINET', category: cat,
        caseNumber: String(caseNumber), claimId: c.claim_id ?? c.case_id ?? null,
        claimKind: c.claim_kind ?? null, instance: c.instance ?? null,
        status, statusLabel: STATUS_UZ[status] ?? null, caseResult: c.case_result ?? null,
        courtId: c.court_id ?? null, hearingDate: toDate(c.hearing_date), registryDt: toDate(c.registry_dt),
        matchedBy: pinfl ? 'NAME' : 'UNMATCHED', snapshotId: snap!.id,
      });
    }
  }

  // Upsert all rows.
  for (const row of rows) {
    await prisma.clientCaseStatus.upsert({
      where: { source_caseNumber: { source: 'CABINET', caseNumber: row.caseNumber } },
      create: row, update: row,
    });
  }

  return { branchCode, totalCases: rows.length, matched, unmatched: rows.length - matched, byStatus };
}
