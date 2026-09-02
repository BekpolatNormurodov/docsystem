import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { buildFarmoyishDocx } from '@/lib/farmoyish-docx';
import { buildFarmoyishExcel } from '@/lib/farmoyish-excel';

export const runtime = 'nodejs';

// GET ?batchId=&format= — bitta partiya farmoyishi. format=xlsx → Excel, aks holda Word (.docx).
export async function GET(req: NextRequest) {
  await requireUser();
  const batchId = Number(req.nextUrl.searchParams.get('batchId'));
  const isXlsx = req.nextUrl.searchParams.get('format') === 'xlsx';
  if (!batchId) return NextResponse.json({ error: 'batchId kerak' }, { status: 400 });
  try {
    const { buffer, fileName } = isXlsx ? await buildFarmoyishExcel(batchId) : await buildFarmoyishDocx(batchId);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': isXlsx
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Farmoyish xatosi' }, { status: 400 });
  }
}
