import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { loanToAriza } from '@/core/ariza';
import { buildArizaDocx } from '@/lib/ariza-docx';

export const runtime = 'nodejs';

/** Keeps only ASCII-safe characters for a Content-Disposition filename. */
function asciiSafe(s: string): string {
  return s.replace(/[^\x20-\x7E]/g, '').replace(/["\\]/g, '').trim() || 'ariza';
}

export async function GET(_req: Request, { params }: { params: { loanId: string } }) {
  await requireAdmin();

  const loan = await prisma.loan.findUnique({ where: { id: Number(params.loanId) } });
  if (!loan) return NextResponse.json({ error: 'Loan not found' }, { status: 404 });

  const [firm, snapshot, settings] = await Promise.all([
    loan.branchCode ? prisma.firm.findUnique({ where: { code: loan.branchCode } }) : null,
    prisma.snapshot.findUnique({ where: { id: loan.snapshotId } }),
    getSettings(),
  ]);

  // A firm-less loan (no matching Firm row) still renders, with the branch code as its name.
  const arizaFirm = {
    shortName: firm?.shortName || loan.branchCode || 'Unknown',
    legalName: firm?.legalName ?? null,
    address: firm?.address ?? null,
    bankAccount: firm?.bankAccount ?? null,
    mfo: firm?.mfo ?? null,
    stir: firm?.stir ?? null,
  };

  const reportDate = snapshot?.reportDate ?? new Date();
  const props = loanToAriza(loan, arizaFirm, settings, reportDate);
  const buffer = await buildArizaDocx({ ...props });

  const filename = asciiSafe(`${loan.ldId ?? loan.id} ${loan.clientName ?? ''}`.trim());

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}.docx"`,
    },
  });
}
