import fs from 'node:fs/promises';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { buildFarmoyishDocx } from '@/lib/farmoyish-docx';
import { getRestBatch, getRestBatchPdfs, getRestBatchReport, type ReportRow } from '@/lib/invoice-rest';

export const runtime = 'nodejs';

const COLUMNS: { key: keyof ReportRow; header: string; width: number }[] = [
  { key: 'tr', header: 'T/R', width: 6 },
  { key: 'invoiceNo', header: 'Invoice raqam', width: 20 },
  { key: 'firmName', header: 'Tashkilot nomi', width: 32 },
  { key: 'stir', header: 'STIR', width: 14 },
  { key: 'amount', header: 'Summa', width: 14 },
  { key: 'pdf', header: 'PDF fayl', width: 24 },
  { key: 'status', header: 'Holat', width: 30 },
];

async function buildReportXlsx(rows: ReportRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Kvitansiyalar');
  ws.addRow(COLUMNS.map((c) => c.header));
  ws.getRow(1).font = { bold: true };
  COLUMNS.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });
  for (const r of rows) ws.addRow(COLUMNS.map((c) => r[c.key]));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// GET — batchning barcha PDF'lari + Excel hisoboti bitta ZIP bo'lib yuklanadi.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  await requireUser();
  const b = await getRestBatch(params.id);
  if (!b) return NextResponse.json({ error: 'topilmadi' }, { status: 404 });

  const [pdfs, report] = await Promise.all([getRestBatchPdfs(params.id), getRestBatchReport(params.id)]);
  if (pdfs.length === 0 && !report) return NextResponse.json({ error: 'Yuklangan maʼlumot yoʻq' }, { status: 404 });

  const zip = new JSZip();
  // 1) PDF'lar.
  for (const { invoiceNo } of pdfs) {
    try {
      const buf = await fs.readFile(path.join(process.cwd(), 'storage', 'invoices', `${invoiceNo}.pdf`));
      zip.file(`${invoiceNo}.pdf`, buf);
    } catch { /* fayl topilmasa o'tkazamiz */ }
  }
  // 2) Excel hisobot (barcha kvitansiyalar — OK va xato).
  if (report && report.rows.length > 0) {
    zip.file('Hisobot.xlsx', await buildReportXlsx(report.rows));
  }
  // 3) Farmoyish (buxgalteriya) DOCX — invoice PDF'lari yonida, buxgalterga tayyor paket. Rest-batch →
  //    InvoiceRecord → case.batchId (InvoiceBatch) orqali topiladi. Best-effort — bo'lmasa ZIP baribir chiqadi.
  try {
    const rec = await prisma.invoiceRecord.findFirst({
      where: { restBatchId: params.id, caseId: { not: null } },
      select: { case: { select: { batchId: true } } },
    });
    const invBatchId = rec?.case?.batchId ?? null;
    if (invBatchId) {
      const { buffer, fileName } = await buildFarmoyishDocx(invBatchId);
      zip.file(fileName, buffer);
    }
  } catch (e) { console.error('batch zip: farmoyish qoʻshilmadi', e); }

  const out = await zip.generateAsync({ type: 'nodebuffer' });
  return new NextResponse(new Uint8Array(out), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(`Invoices_${params.id}.zip`)}"`,
    },
  });
}
