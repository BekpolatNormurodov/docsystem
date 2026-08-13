import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { buildFarmoyishDocx } from '@/lib/farmoyish-docx';

export const runtime = 'nodejs';

// GET ?batchId= — download the buxgalteriya farmoyishi DOCX for a batch.
export async function GET(req: NextRequest) {
  await requireUser();
  const batchId = Number(req.nextUrl.searchParams.get('batchId'));
  if (!batchId) return NextResponse.json({ error: 'batchId kerak' }, { status: 400 });
  try {
    const { buffer, fileName } = await buildFarmoyishDocx(batchId);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Farmoyish xatosi' }, { status: 400 });
  }
}
