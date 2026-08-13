import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { loansToAriza } from '@/core/ariza';
import { buildArizaDocx } from '@/lib/ariza-docx';

export const runtime = 'nodejs';

/** Keeps only ASCII-safe characters for a Content-Disposition filename. */
function asciiSafe(s: string): string {
  return s.replace(/[^\x20-\x7E]/g, '').replace(/["\\]/g, '').trim() || 'ariza';
}

export async function GET(_req: Request, { params }: { params: { loanId: string } }) {
  await requireAdmin();

  const id = Number(params.loanId);
  // A non-numeric/float id must be a clean 404, not a Prisma NaN-validation 500.
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Loan not found' }, { status: 404 });

  const loan = await prisma.loan.findUnique({ where: { id } });
  if (!loan) return NextResponse.json({ error: 'Loan not found' }, { status: 404 });

  const [firm, snapshot, settings, groupLoans] = await Promise.all([
    loan.branchCode ? prisma.firm.findUnique({ where: { code: loan.branchCode } }) : null,
    prisma.snapshot.findUnique({ where: { id: loan.snapshotId } }),
    getSettings(),
    // All of this client's loans at the same firm — one combined ariza. ONLY group when both
    // identity keys are present: a null pinfl/branchCode would match EVERY other identity-less loan
    // and merge unrelated debtors into a single petition, so an identity-less loan stays a group of one.
    loan.pinfl && loan.branchCode
      ? prisma.loan.findMany({
          where: { snapshotId: loan.snapshotId, pinfl: loan.pinfl, branchCode: loan.branchCode },
          orderBy: { id: 'asc' },
        })
      : Promise.resolve([loan]),
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
  const props = loansToAriza(groupLoans.length ? groupLoans : [loan], arizaFirm, settings, reportDate);
  // A ≤ 0 demand is a void petition («0 soʻm undirish») — refuse to generate it.
  if (Number(props.debtTotal) <= 0) return NextResponse.json({ error: 'Qarzdorlik 0 — ariza yaratilmaydi' }, { status: 422 });
  const buffer = await buildArizaDocx({ ...props });

  const filename = asciiSafe(`${loan.clientName ?? ''} ${arizaFirm.shortName}`.trim());

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}.docx"`,
    },
  });
}
