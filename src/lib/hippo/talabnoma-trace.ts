// Talabnoma «iz» (trace): which clients have already had their talabnoma sent to xat.hippo, so a
// count-batch never sends the same client twice and the NEXT batch picks up where the last left off
// («keyngi safar count belgilasa narigilarni ursin»). Stored in ClientCaseStatus (source HIPPO,
// category 'talabnoma') — the SAME table status-ingest fills from real hippo mails, so a client that
// already has a real hippo talabnoma also counts as sent. No schema migration needed.
//
// Key: one row per (snapshot, firm-branch, PINFL) via a synthetic caseNumber, so a re-send updates
// the same row (points it at the newest registry) instead of piling up duplicates. Blank-PINFL
// debtors have no reliable key, so they are NOT traced (always treated as «remaining») — matches the
// funnel-mark rule in loadTalabnomaRowsForScope.
import { prisma } from '@/lib/db';
import type { TalabnomaRow } from './talabnoma-excel';

const traceKey = (snapshotId: number, branchCode: string, pinfl: string) => `TLB:${snapshotId}:${branchCode}:${pinfl}`;
const hasPinfl = (r: TalabnomaRow): r is TalabnomaRow & { pinfl: string } => !!(r.pinfl && String(r.pinfl).trim());

/** PINFLs already sent BY US for one firm-branch in one snapshot. Counts only our own synthetic
 *  trace rows (caseNumber «TLB:…»), so real hippo mails ingested from an earlier external send
 *  («tortilganlar») are ignored — no hardcoded date involved. */
export async function getSentTalabnomaPinfls(snapshotId: number, branchCode: string): Promise<Set<string>> {
  const rows = await prisma.clientCaseStatus.findMany({
    where: {
      source: 'HIPPO', category: 'talabnoma', snapshotId, branchCode,
      pinfl: { not: null }, caseNumber: { startsWith: 'TLB:' },
    },
    select: { pinfl: true },
  });
  const set = new Set<string>();
  for (const r of rows) if (r.pinfl) set.add(String(r.pinfl));
  return set;
}

/** Split rows into the ones still to send (not yet traced) and the count already sent. Blank-PINFL
 *  rows can't be traced → always counted as remaining. */
export function splitBySent(rows: TalabnomaRow[], sent: Set<string>): { remaining: TalabnomaRow[]; sentCount: number } {
  const remaining: TalabnomaRow[] = [];
  let sentCount = 0;
  for (const r of rows) {
    if (hasPinfl(r) && sent.has(String(r.pinfl))) sentCount += 1;
    else remaining.push(r);
  }
  return { remaining, sentCount };
}

/** Record a just-sent batch as trace rows (PINFL → registry). Returns how many were traced. */
export async function recordSentTalabnomas(
  rows: TalabnomaRow[],
  opts: { snapshotId: number; branchCode: string; registryId: string; status: string },
): Promise<number> {
  let n = 0;
  for (const r of rows) {
    if (!hasPinfl(r)) continue; // no key → can't trace (stays «remaining»)
    const pinfl = String(r.pinfl);
    const caseNumber = traceKey(opts.snapshotId, opts.branchCode, pinfl);
    await prisma.clientCaseStatus.upsert({
      where: { source_caseNumber: { source: 'HIPPO', caseNumber } },
      create: {
        branchCode: opts.branchCode, pinfl, clientName: r.receiver || pinfl, source: 'HIPPO',
        category: 'talabnoma', caseNumber, claimId: opts.registryId || null, status: opts.status,
        matchedBy: 'PINFL', snapshotId: opts.snapshotId, registryDt: new Date(),
      },
      update: { claimId: opts.registryId || null, status: opts.status, registryDt: new Date(), snapshotId: opts.snapshotId },
    });
    n += 1;
  }
  return n;
}

/** Un-trace a cancelled registry: drop our trace rows that point at it, so those clients become
 *  «remaining» again and can be re-sent. Keyed by claimId = the registry id. */
export async function clearSentByRegistry(registryId: string): Promise<number> {
  if (!registryId) return 0;
  const res = await prisma.clientCaseStatus.deleteMany({
    where: { source: 'HIPPO', category: 'talabnoma', claimId: registryId },
  });
  return res.count;
}
