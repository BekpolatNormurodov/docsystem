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
// The registry's send date (tolerant of field-name variants) — stamped onto each mail's trace row as
// registryDt so the talabnoma «iz»/epoch can tell recent (real, lawyer-sent) reyestrs from old ones.
const regDate = (r: any) => r?.createdAt ?? r?.createdDate ?? r?.created ?? r?.createdOn ?? r?.date ?? null;
const toDate = (v: any): Date | null => { if (!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; };

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
  // A `null` value marks an AMBIGUOUS key: two distinct clients share this normalized
  // name form, so a name-only match must fall through to UNMATCHED rather than pick one.
  const idx = new Map<string, string | null>();
  const put = (k: string, pinfl: string) => {
    if (!idx.has(k)) idx.set(k, pinfl);
    else if (idx.get(k) !== pinfl) idx.set(k, null); // collision → ambiguous
  };
  for (const l of loans) {
    if (!l.clientName || !l.pinfl) continue;
    put(normName(l.clientName), l.pinfl); // Latin form
    put(normName(latinToCyrillic(l.clientName)), l.pinfl); // Cyrillic form
  }
  return idx;
}

export async function ingestHippoStatuses(
  session: HippoSession, branchCode: string,
): Promise<HippoIngestResult> {
  const snap = await prisma.snapshot.findFirst({ orderBy: { reportDate: 'desc' } });
  if (!snap) throw new Error('ingestHippoStatuses: portfel snapshot topilmadi');
  const idx = await buildCyrIndex(branchCode, snap.id);

  const byStatus: Record<string, number> = {};
  let total = 0, matched = 0, failed = 0;

  // Page through the registry LIST too — a firm with >100 registries would
  // otherwise silently drop every registry past the first page.
  for (let rp = 1; ; rp++) {
    let registries: any[];
    try {
      const { json } = await listRegistries(session, { PageIndex: rp, PageSize: 100 });
      registries = asArray(json);
    } catch (e) {
      // A registry-LIST page failed (502/parse/timeout) — stop paging with what we
      // have rather than aborting the whole ingest (matches cabinet detail-ingest).
      console.error(`ingestHippoStatuses: registry list page ${rp} failed (${branchCode})`, e);
      failed++; break;
    }
    if (!registries.length) break;
    for (const reg of registries) {
      // The batch's send date → registryDt on every mail it contains (the «iz» epoch reads this).
      const regDt = toDate(regDate(reg)) ?? toDate(reg?.registryDt);
      try {
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
          const mailDt = regDt ?? toDate(m.createdAt ?? m.sendDate ?? m.createdDate);
          await prisma.clientCaseStatus.upsert({
            where: { source_caseNumber: { source: 'HIPPO', caseNumber: String(m.uid) } },
            create: {
              branchCode, pinfl, clientName: receiver, source: 'HIPPO', category: 'talabnoma',
              caseNumber: String(m.uid), claimId: String(reg.id), status, statusLabel: null,
              caseResult: m.sendStatus ?? null, matchedBy: pinfl ? 'NAME' : 'UNMATCHED', snapshotId: snap.id,
              registryDt: mailDt,
            },
            // refresh snapshotId too so a re-ingest under a newer snapshot doesn't
            // leave B-derived pinfl attributed to snapshot A.
            update: { status, caseResult: m.sendStatus ?? null, pinfl, matchedBy: pinfl ? 'NAME' : 'UNMATCHED', snapshotId: snap.id, registryDt: mailDt },
          });
        }
        if (mails.length < 100) break;
      }
      } catch (e) {
        // One registry's mail fetch failed — skip it and continue with the rest.
        console.error(`ingestHippoStatuses: registry ${reg?.id} mails failed (${branchCode})`, e);
        failed++;
      }
    }
    if (registries.length < 100) break;
  }
  if (failed) console.warn(`ingestHippoStatuses: ${failed} registr(y/ies) skipped after fetch errors (${branchCode})`);
  return { branchCode, totalMails: total, matched, unmatched: total - matched, byStatus };
}
