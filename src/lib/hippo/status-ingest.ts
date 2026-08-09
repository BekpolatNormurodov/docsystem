// Pull xat.hippo talabnoma letters + delivery statuses for a firm and persist them
// to ClientCaseStatus (source HIPPO), matched to portfolio clients by receiver
// name. Portfolio names are Latin; hippo receiver names are Cyrillic, so we
// transliterate Latin->Cyrillic before normalising. Reuses a hippo session.
import { prisma } from '../db';
import { listRegistries, listRegistryMails } from './xat';
import type { HippoSession } from './login';
import { latinToCyrillic } from '../../core/uz-latin-to-cyrillic';
import { normName } from '../cabinet/status-ingest';

const asArray = (j: any): any[] => (Array.isArray(j) ? j : j?.content ?? j?.data?.items ?? j?.items ?? j?.data ?? []);

export interface HippoIngestResult {
  branchCode: string; totalMails: number; matched: number; unmatched: number;
  byStatus: Record<string, number>;
}

// norm(name) -> pinfl. hippo receiverName can be EITHER Latin (as stored in the
// portfolio) OR Cyrillic (transliterated talabnomas), so index BOTH forms.
async function buildCyrIndex(branchCode: string, snapshotId: number) {
  const loans = await prisma.loan.findMany({
    where: { snapshotId, branchCode }, select: { clientName: true, pinfl: true },
  });
  const idx = new Map<string, string>();
  for (const l of loans) {
    if (!l.clientName || !l.pinfl) continue;
    idx.set(normName(l.clientName), l.pinfl); // Latin form
    idx.set(normName(latinToCyrillic(l.clientName)), l.pinfl); // Cyrillic form
  }
  return idx;
}

export async function ingestHippoStatuses(
  session: HippoSession, branchCode: string,
): Promise<HippoIngestResult> {
  const snap = await prisma.snapshot.findFirst({ orderBy: { reportDate: 'desc' } });
  const idx = await buildCyrIndex(branchCode, snap!.id);

  const { json } = await listRegistries(session, { PageIndex: 1, PageSize: 100 });
  const registries = asArray(json);

  const byStatus: Record<string, number> = {};
  let total = 0, matched = 0;

  for (const reg of registries) {
    for (let page = 1; ; page++) {
      const res = await listRegistryMails(session, reg.id, page, 100);
      const mails = asArray(res.json);
      if (!mails.length) break;
      for (const m of mails) {
        if (!m.uid) continue;
        const receiver = m.receiverName ?? m.receiver ?? '';
        const pinfl = idx.get(normName(receiver)) ?? null;
        if (pinfl) matched++;
        const status = m.activePerform?.performType ?? m.sendStatus ?? (m.isSend ? 'SENT' : 'CREATED');
        byStatus[status] = (byStatus[status] ?? 0) + 1;
        total++;
        await prisma.clientCaseStatus.upsert({
          where: { source_caseNumber: { source: 'HIPPO', caseNumber: String(m.uid) } },
          create: {
            branchCode, pinfl, clientName: receiver, source: 'HIPPO', category: 'talabnoma',
            caseNumber: String(m.uid), claimId: String(reg.id), status, statusLabel: null,
            caseResult: m.sendStatus ?? null, matchedBy: pinfl ? 'NAME' : 'UNMATCHED', snapshotId: snap!.id,
          },
          update: { status, caseResult: m.sendStatus ?? null, pinfl, matchedBy: pinfl ? 'NAME' : 'UNMATCHED' },
        });
      }
      if (mails.length < 100) break;
    }
  }
  return { branchCode, totalMails: total, matched, unmatched: total - matched, byStatus };
}
