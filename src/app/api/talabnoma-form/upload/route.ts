import fs from 'node:fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { enqueueJob } from '@/lib/job-dispatch';
import { audit, AuditAction } from '@/lib/audit';
import { batchDir, sourceXlsxPath, portfolioXlsxPath } from '@/lib/talabnoma-form/store';

export const runtime = 'nodejs';
export const maxDuration = 300;

// POST multipart { source, portfolio, label? } — save the two Excels on disk, create a batch row that
// keeps their paths, and enqueue a parse job. Fire-and-forget: the client polls the batch status.
export async function POST(req: NextRequest) {
  const user = await requireAdmin();

  const form = await req.formData();
  const source = form.get('source') as File | null; // 20.08 talabnoma manba
  const portfolio = form.get('portfolio') as File | null; // портфель
  const label = (String(form.get('label') ?? '').trim() || null) as string | null;

  if (!source) return NextResponse.json({ error: 'source (talabnoma Excel) majburiy' }, { status: 400 });
  if (!portfolio) return NextResponse.json({ error: 'portfolio (портфель) majburiy' }, { status: 400 });
  const isXlsx = (f: File) => /\.xlsx$/i.test(f.name);
  if (!isXlsx(source) || !isXlsx(portfolio)) {
    return NextResponse.json({ error: 'Ikkala fayl ham .xlsx bo‘lishi kerak' }, { status: 400 });
  }

  const batch = await prisma.talabnomaFormBatch.create({
    data: {
      createdBy: user.username,
      label,
      status: 'PARSING',
      sourceFileName: source.name,
      sourcePath: '',
      portfolioFileName: portfolio.name,
      portfolioPath: '',
    },
  });

  await fs.mkdir(batchDir(batch.id), { recursive: true });
  const sPath = sourceXlsxPath(batch.id);
  const pPath = portfolioXlsxPath(batch.id);
  await fs.writeFile(sPath, Buffer.from(await source.arrayBuffer()));
  await fs.writeFile(pPath, Buffer.from(await portfolio.arrayBuffer()));
  await prisma.talabnomaFormBatch.update({ where: { id: batch.id }, data: { sourcePath: sPath, portfolioPath: pPath } });

  const job = await prisma.job.create({
    data: { type: 'TALABNOMA_FORM', status: 'PENDING', total: 1, params: { action: 'parse', batchId: batch.id } },
  });

  await audit(AuditAction.IMPORT, {
    target: `talabnoma-form:${batch.id}`,
    detail: { source: source.name, portfolio: portfolio.name, jobId: job.id },
  }).catch(() => {});

  enqueueJob(job.id);

  return NextResponse.json({ batchId: batch.id, jobId: job.id });
}
