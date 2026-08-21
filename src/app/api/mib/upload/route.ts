import fs from 'node:fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { parseHisobot } from '@/lib/mib/parse';
import { mibReportDir, mibSourceXlsxPath } from '@/lib/mib/store';

export const runtime = 'nodejs';
export const maxDuration = 120;

// POST multipart { file, label? } — save a HISOBOT .xlsx, parse it, and return the distinct «Holat»
// values (with counts) so the operator can pick which status to run (e.g. «MIBda»).
export async function POST(req: NextRequest) {
  const user = await requireAdmin();
  const form = await req.formData();
  const file = form.get('file') as File | null;
  const label = (String(form.get('label') ?? '').trim() || null) as string | null;
  if (!file) return NextResponse.json({ error: 'file majburiy' }, { status: 400 });
  if (!/\.xlsx$/i.test(file.name)) return NextResponse.json({ error: 'Fayl .xlsx bo‘lishi kerak' }, { status: 400 });

  const report = await prisma.mibReport.create({
    data: { createdBy: user.username, label, sourceFileName: file.name, sourcePath: '' },
  });
  await fs.mkdir(mibReportDir(report.id), { recursive: true });
  const p = mibSourceXlsxPath(report.id);
  await fs.writeFile(p, Buffer.from(await file.arrayBuffer()));
  await prisma.mibReport.update({ where: { id: report.id }, data: { sourcePath: p } });

  let holatValues: { value: string; count: number }[] = [];
  let totalRows = 0;
  try {
    const parsed = await parseHisobot(p);
    holatValues = parsed.holatValues;
    totalRows = parsed.rows.length;
  } catch (e) {
    return NextResponse.json({ error: `Excel o‘qilmadi: ${(e as Error).message}`, reportId: report.id }, { status: 422 });
  }

  return NextResponse.json({ reportId: report.id, holatValues, totalRows });
}
