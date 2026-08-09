import { describe, it, expect } from 'vitest';
import { prisma } from './db';

const REPORT_DATE = new Date('2026-08-01');

describe('Snapshot/Loan/Job schema', () => {
  it('creates, reads back, and deletes a Snapshot with a Loan and a Job', async () => {
    // Self-heal: a prior interrupted run (e.g. a timeout before the final delete)
    // can leave this unique-reportDate snapshot behind and wedge every future run.
    const orphans = await prisma.snapshot.findMany({ where: { reportDate: REPORT_DATE }, select: { id: true } });
    if (orphans.length) {
      const ids = orphans.map((o) => o.id);
      await prisma.job.deleteMany({ where: { snapshotId: { in: ids } } });
      await prisma.snapshot.deleteMany({ where: { id: { in: ids } } }); // cascades Loan
    }

    const snapshot = await prisma.snapshot.create({
      data: {
        reportDate: REPORT_DATE,
        sourceFileName: 'test-portfolio.xlsx',
      },
    });

    const loan = await prisma.loan.create({
      data: {
        snapshotId: snapshot.id,
        pinfl: '12345678901234',
        clientName: 'Test Client',
        debtPrincipal: 100,
        debtTermInterest: 10,
        debtOverduePrincipal: 5,
        debtOverdueInterest: 1,
        totalDebt: 116,
        raw: { a: 1 },
      },
    });

    const job = await prisma.job.create({
      data: {
        type: 'IMPORT',
        snapshotId: snapshot.id,
      },
    });

    const foundSnapshot = await prisma.snapshot.findUniqueOrThrow({
      where: { id: snapshot.id },
      include: { loans: true },
    });
    expect(foundSnapshot.sourceFileName).toBe('test-portfolio.xlsx');
    expect(foundSnapshot.status).toBe('IMPORTING');
    expect(foundSnapshot.loans).toHaveLength(1);

    const foundLoan = await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } });
    expect(foundLoan.pinfl).toBe('12345678901234');
    expect(foundLoan.clientName).toBe('Test Client');
    expect(Number(foundLoan.totalDebt)).toBe(116);
    expect(foundLoan.raw).toEqual({ a: 1 });

    const foundJob = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(foundJob.type).toBe('IMPORT');
    expect(foundJob.status).toBe('PENDING');
    expect(foundJob.snapshotId).toBe(snapshot.id);

    await prisma.job.delete({ where: { id: job.id } });
    await prisma.snapshot.delete({ where: { id: snapshot.id } }); // cascades Loan
  });
});
