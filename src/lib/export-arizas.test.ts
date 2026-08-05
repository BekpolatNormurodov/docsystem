import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import unzipper from 'unzipper';
import { prisma } from './db';
import { runExportJob } from './export-arizas';

describe('runExportJob', () => {
  let snapshotId: number | null = null;
  let jobId: number | null = null;
  let firmCode: string | null = null;
  let zipPath: string | null = null;

  afterEach(async () => {
    if (jobId !== null) {
      await prisma.job.delete({ where: { id: jobId } }).catch(() => {});
      jobId = null;
    }
    if (snapshotId !== null) {
      await prisma.snapshot.delete({ where: { id: snapshotId } }); // cascades Loan
      snapshotId = null;
    }
    if (firmCode !== null) {
      await prisma.firm.delete({ where: { code: firmCode } }).catch(() => {});
      firmCode = null;
    }
    if (zipPath) {
      await fs.rm(zipPath, { force: true });
      zipPath = null;
    }
  });

  it('exports matching loans as ariza .docx files into a ZIP and marks the Job DONE', async () => {
    const reportDate = new Date('2026-07-09');
    const snapshot = await prisma.snapshot.create({
      data: { reportDate, sourceFileName: 'fixture.xlsx', status: 'READY' },
    });
    snapshotId = snapshot.id;

    firmCode = `EXPFIRM-${Date.now()}`;
    await prisma.firm.create({
      data: {
        code: firmCode,
        shortName: 'FIRMA',
        legalName: 'FIRMA MCHJ',
        address: 'Toshkent',
        bankAccount: '20208000000000000001',
        mfo: '00450',
        stir: '123456789',
      },
    });

    await prisma.loan.createMany({
      data: [
        {
          snapshotId: snapshot.id,
          pinfl: '111',
          clientName: 'AAA BBB',
          branchCode: firmCode,
          ldId: '2244',
          dateToCr: new Date('2026-01-01'),
          summKr: 1000,
          rate: 30,
          debtPrincipal: 100,
          debtTermInterest: 10,
          debtOverduePrincipal: 5,
          debtOverdueInterest: 1,
          totalDebt: 116,
          raw: {},
        },
        {
          snapshotId: snapshot.id,
          pinfl: '222',
          clientName: 'CCC DDD',
          branchCode: firmCode,
          ldId: '2245',
          dateToCr: new Date('2026-01-02'),
          summKr: 2000,
          rate: 30,
          debtPrincipal: 200,
          debtTermInterest: 20,
          debtOverduePrincipal: 10,
          debtOverdueInterest: 2,
          totalDebt: 232,
          raw: {},
        },
      ],
    });

    const job = await prisma.job.create({
      data: { type: 'EXPORT', status: 'PENDING', snapshotId: snapshot.id, total: 2 },
    });
    jobId = job.id;

    await runExportJob(job.id, { snapshotId: snapshot.id });

    const updated = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(updated.status).toBe('DONE');
    expect(updated.progress).toBe(2);
    expect(updated.resultPath).toBe(`exports/${job.id}.zip`);

    zipPath = path.join(process.cwd(), updated.resultPath!);
    expect(fsSync.existsSync(zipPath)).toBe(true);

    const directory = await unzipper.Open.file(zipPath);
    expect(directory.files).toHaveLength(2);
    expect(directory.files.map((f) => f.path).sort()).toEqual([
      '09.07.26/AAA BBB 111/FIRMA/2244 AAA BBB.docx',
      '09.07.26/CCC DDD 222/FIRMA/2245 CCC DDD.docx',
    ]);
  });
});
