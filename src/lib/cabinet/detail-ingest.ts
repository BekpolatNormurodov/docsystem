// Enrich cabinet cases with their full detail (get-one-case-by-id): the detail
// exposes the defendant PINFL (hidden in list views), enabling EXACT pinfl
// linking + address/passport/judge. Updates ClientCaseStatus in place.
import { prisma } from '../db';
import { cabinetFetch } from './api';
import type { CabinetSession } from './oneid';

const CATS = ['civil', 'economic', 'administrative', 'conflict'] as const;
const LISTS = ['first-materials', 'first-non-material-cases', 'all-cases'] as const;
const asArray = (j: any): any[] => (Array.isArray(j) ? j : j?.content ?? j?.data ?? []);
const toDate = (v: any) => { const d = v ? new Date(v) : null; return d && !isNaN(d.getTime()) ? d : null; };

// run `tasks` with a bounded concurrency pool
async function pool<T>(items: T[], limit: number, fn: (t: T, i: number) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  }));
}

export interface DetailResult { total: number; fetched: number; withPinfl: number; failed: number }

export async function ingestCabinetDetails(
  session: CabinetSession, branchCode: string, opts: { concurrency?: number } = {},
): Promise<DetailResult> {
  // re-pull the list to get case_id (the detail key) alongside our stored caseNumber
  const cases: { caseId: string; caseNumber: string }[] = [];
  const seen = new Set<string>();
  for (const cat of CATS) for (const list of LISTS) {
    try {
      const r = await cabinetFetch(session, `/api/cabinet/case/${cat}/${list}`);
      if (r.status !== 200) continue;
      for (const c of asArray(r.json)) {
        const key = c.case_number ?? c.case_id ?? c.claim_id;
        if (!key || seen.has(key) || !c.case_id) continue;
        seen.add(key);
        cases.push({ caseId: c.case_id, caseNumber: String(key) });
      }
    } catch { /* one flaky list endpoint must not abort the whole ingest */ }
  }

  const res: DetailResult = { total: cases.length, fetched: 0, withPinfl: 0, failed: 0 };
  const snap = await prisma.snapshot.findFirst({ orderBy: { reportDate: 'desc' } });

  await pool(cases, opts.concurrency ?? 6, async (c) => {
    try {
      const r = await cabinetFetch(session, `/api/cabinet/case/get-one-case-by-id/${c.caseId}`);
      const d: any = r.json ?? {};
      if (!d || !d.participants) { res.failed++; return; }
      res.fetched++;

      const defs = (d.participants || []).filter((p: any) => p?.participant?.type === 'DEFENDANT');
      const main = defs.find((p: any) => p?.participant?.is_main) ?? defs[0];
      const pinfl = main?.entity?.pinfl ? String(main.entity.pinfl) : null;
      const det = main?.entity_details ?? {};
      const address = det.address ?? det.mailing_address ?? null;
      const passport = det.passport_serial || det.passport_number ? `${det.passport_serial ?? ''}${det.passport_number ?? ''}` : null;
      // link exactly to our portfolio client by that pinfl (confirm it's ours)
      let ourPinfl: string | null = null;
      let inPortfolio = false;
      if (pinfl && snap) {
        const loan = await prisma.loan.findFirst({ where: { snapshotId: snap.id, branchCode, pinfl }, select: { pinfl: true } });
        inPortfolio = !!loan;
        ourPinfl = loan?.pinfl ?? pinfl; // keep the real defendant pinfl even if not in portfolio
      }
      if (pinfl) res.withPinfl++;

      await prisma.clientCaseStatus.updateMany({
        where: { source: 'CABINET', caseNumber: c.caseNumber },
        data: {
          pinfl: ourPinfl ?? pinfl ?? undefined,
          // Claim a confirmed PINFL match ONLY when the defendant is actually in OUR
          // portfolio — a raw cabinet pinfl not among our clients is UNMATCHED, not a match.
          matchedBy: pinfl ? (inPortfolio ? 'PINFL' : 'UNMATCHED') : undefined,
          defAddress: address, defPassport: passport,
          judge: d.chairman ?? d.responsible_judge ?? null,
          registryDt: toDate(d.registry_dt), hearingDate: toDate(d.hearing_date),
          detail: d as any,
        },
      });
    } catch { res.failed++; }
  });

  return res;
}
