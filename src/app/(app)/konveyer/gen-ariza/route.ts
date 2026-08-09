import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { loansToAriza } from '@/core/ariza';
import { buildArizaDocx } from '@/lib/ariza-docx';

export const runtime = 'nodejs';

// GET ?caseId= — generate this client's court ariza (.docx) on the fly, keyed by
// the konveyer case (finds the client's loans and reuses the ariza builder).
export async function GET(req: NextRequest) {
  await requireAdmin();
  const caseId = Number(req.nextUrl.searchParams.get('caseId'));
  if (!caseId) return NextResponse.json({ error: 'caseId kerak' }, { status: 400 });

  const ac = await prisma.arizaCase.findUnique({
    where: { id: caseId },
    select: { pinfl: true, snapshotId: true, kod: true, clientName: true },
  });
  if (!ac?.pinfl || !ac.snapshotId) return NextResponse.json({ error: 'Case maʼlumoti yoʻq' }, { status: 404 });

  const [firm, snapshot, settings, groupLoans] = await Promise.all([
    ac.kod ? prisma.firm.findUnique({ where: { code: ac.kod } }) : null,
    prisma.snapshot.findUnique({ where: { id: ac.snapshotId } }),
    getSettings(),
    prisma.loan.findMany({
      where: { snapshotId: ac.snapshotId, pinfl: ac.pinfl, ...(ac.kod ? { branchCode: ac.kod } : {}) },
      orderBy: { id: 'asc' },
    }),
  ]);
  if (groupLoans.length === 0) return NextResponse.json({ error: 'Portfel maʼlumoti topilmadi' }, { status: 404 });

  const arizaFirm = {
    shortName: firm?.shortName || ac.kod || 'Unknown',
    legalName: firm?.legalName ?? null,
    address: firm?.address ?? null,
    bankAccount: firm?.bankAccount ?? null,
    mfo: firm?.mfo ?? null,
    stir: firm?.stir ?? null,
  };
  const reportDate = snapshot?.reportDate ?? new Date();
  let buffer: Awaited<ReturnType<typeof buildArizaDocx>>;
  try {
    const props = loansToAriza(groupLoans, arizaFirm, settings, reportDate);
    buffer = await buildArizaDocx({ ...props });
  } catch (e) {
    console.error('gen-ariza failed', e);
    return NextResponse.json({ error: 'Ariza yaratilmadi' }, { status: 500 });
  }

  const safe = (ac.clientName || `case-${caseId}`).replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(`Ariza_${safe}.docx`)}"`,
    },
  });
}
