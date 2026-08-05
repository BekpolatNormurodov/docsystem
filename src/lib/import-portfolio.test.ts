import { describe, it, expect, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { prisma } from './db';
import { importPortfolio } from './import-portfolio';
import { makeFixture, DEFAULT_FIXTURE_ROWS } from './make-fixture';

describe('importPortfolio', () => {
  let snapshotId: number | null = null;
  let fixturePath: string | null = null;

  afterEach(async () => {
    if (snapshotId !== null) {
      await prisma.snapshot.delete({ where: { id: snapshotId } }); // cascades Loan
      snapshotId = null;
    }
    if (fixturePath) {
      await fs.rm(fixturePath, { force: true });
      fixturePath = null;
    }
  });

  it('streams the first pinfl-bearing worksheet, inserts loans, and ignores the decoy sheet', async () => {
    fixturePath = path.join(os.tmpdir(), `portfolio-fixture-${Date.now()}.xlsx`);
    await makeFixture(fixturePath);

    const snapshot = await prisma.snapshot.create({
      data: { reportDate: new Date('2026-08-01'), sourceFileName: 'fixture.xlsx' },
    });
    snapshotId = snapshot.id;

    const progressCalls: number[] = [];
    const result = await importPortfolio(fixturePath, snapshot.id, (n) => progressCalls.push(n));

    expect(result.rows).toBe(3);
    const expectedTotal = DEFAULT_FIXTURE_ROWS.reduce(
      (sum, r) => sum + r.summOstZe + r.sumprocEqv + r.summOstprZe + r.sumnachprEqv,
      0,
    );
    expect(result.totalDebt).toBe(expectedTotal);
    expect(result.excludedCount).toBe(0);
    expect(progressCalls.length).toBeGreaterThan(0);
    expect(progressCalls.at(-1)).toBe(3);

    const loans = await prisma.loan.findMany({
      where: { snapshotId: snapshot.id },
      orderBy: { pinfl: 'asc' },
    });
    expect(loans).toHaveLength(3);

    const first = loans[0];
    expect(first.pinfl).toBe('10000000000001');
    expect(first.clientName).toBe('ALPHA ONE');
    expect(first.branchCode).toBe('12842');
    expect(Number(first.debtPrincipal)).toBe(100);
    expect(Number(first.debtTermInterest)).toBe(10);
    expect(Number(first.debtOverduePrincipal)).toBe(5);
    expect(Number(first.debtOverdueInterest)).toBe(1);
    expect(Number(first.totalDebt)).toBe(116);
    expect(first.raw).toMatchObject({ pinfl: '10000000000001', client_name: 'ALPHA ONE' });

    // decoy worksheet must never produce a Loan (no junk_column header, no extra rows)
    for (const l of loans) {
      expect(l.raw).not.toHaveProperty('junk_column');
    }

    const updatedSnapshot = await prisma.snapshot.findUniqueOrThrow({ where: { id: snapshot.id } });
    expect(updatedSnapshot.processedRows).toBe(3);
    expect(Number(updatedSnapshot.totalDebt)).toBe(expectedTotal);
  });

  it('marks loans whose pinfl is in excludedPinfls as excluded', async () => {
    fixturePath = path.join(os.tmpdir(), `portfolio-fixture-excl-${Date.now()}.xlsx`);
    await makeFixture(fixturePath);

    const snapshot = await prisma.snapshot.create({
      data: { reportDate: new Date('2026-08-03'), sourceFileName: 'fixture.xlsx' },
    });
    snapshotId = snapshot.id;

    const excludedPinfls = new Set(['10000000000002']);
    const result = await importPortfolio(fixturePath, snapshot.id, undefined, excludedPinfls);

    expect(result.excludedCount).toBe(1);

    const loans = await prisma.loan.findMany({
      where: { snapshotId: snapshot.id },
      orderBy: { pinfl: 'asc' },
    });
    expect(loans.find((l) => l.pinfl === '10000000000001')?.excluded).toBe(false);
    expect(loans.find((l) => l.pinfl === '10000000000002')?.excluded).toBe(true);
    expect(loans.find((l) => l.pinfl === '10000000000003')?.excluded).toBe(false);
  });
});
