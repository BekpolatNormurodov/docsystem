import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';

// The firm-library documents attached to EVERY court packet of a firm (the guvohnoma/shartnoma the
// operator adds to each of the firm's court-bound clients). These two are universal; ishonchnoma is
// extra for some firms — so «to'liq» requires guvohnoma + shartnoma, ishonchnoma is optional.
const REQUIRED = ['GUVOHNOMA', 'SHARTNOMA'] as const;
const OPTIONAL = ['ISHONCHNOMA'] as const;
const LABEL: Record<string, string> = { GUVOHNOMA: 'guvohnoma', SHARTNOMA: 'shartnoma', ISHONCHNOMA: 'ishonchnoma', OFERTA: 'oferta' };

// GET ?snapshotId=&firmId= — per-firm court-document completeness for the firms that have cases in
// this snapshot (or the one firm). A firm missing a REQUIRED doc is «chala». Used to warn before
// «Ariza yaratish» that some firms' attachment documents are incomplete.
export async function GET(req: NextRequest) {
  await requireUser();
  const sp = req.nextUrl.searchParams;
  const num = (v: string | null): number | undefined => { const n = Number(v); return v != null && v !== '' && Number.isInteger(n) && n > 0 ? n : undefined; };
  const snapshotId = num(sp.get('snapshotId'));
  const firmId = num(sp.get('firmId'));

  // Firms in scope: the picked firm, or every firm with cases in this snapshot.
  let firmIds: number[];
  if (firmId) {
    firmIds = [firmId];
  } else if (snapshotId) {
    const g = await prisma.arizaCase.groupBy({ by: ['firmId'], where: { snapshotId }, _count: true });
    firmIds = g.map((x) => x.firmId);
  } else {
    firmIds = [];
  }
  if (firmIds.length === 0) return NextResponse.json({ firms: [], incomplete: 0 });

  const [firmRows, docs] = await Promise.all([
    prisma.firm.findMany({ where: { id: { in: firmIds } }, select: { id: true, shortName: true, legalName: true, code: true } }),
    prisma.firmDocument.findMany({ where: { firmId: { in: firmIds } }, select: { firmId: true, kind: true } }),
  ]);
  const nameById = new Map(firmRows.map((f) => [f.id, f.shortName || f.legalName || f.code || `firma-${f.id}`]));
  const kindsByFirm = new Map<number, Set<string>>();
  for (const d of docs) {
    const s = kindsByFirm.get(d.firmId) ?? new Set<string>();
    s.add(String(d.kind));
    kindsByFirm.set(d.firmId, s);
  }

  const firms = firmIds.map((id) => {
    const have = kindsByFirm.get(id) ?? new Set<string>();
    const missing = REQUIRED.filter((k) => !have.has(k));
    const present = [...REQUIRED, ...OPTIONAL].filter((k) => have.has(k));
    return {
      firmId: id,
      firmName: nameById.get(id) ?? `firma-${id}`,
      present: present.map((k) => LABEL[k] ?? k),
      missing: missing.map((k) => LABEL[k] ?? k),
      complete: missing.length === 0,
    };
  });
  // Chala firms first (attention), then by name.
  firms.sort((a, b) => (a.complete === b.complete ? a.firmName.localeCompare(b.firmName) : a.complete ? 1 : -1));

  return NextResponse.json({ firms, incomplete: firms.filter((f) => !f.complete).length });
}
