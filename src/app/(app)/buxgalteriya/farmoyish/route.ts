import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import archiver from 'archiver';
import { requireAccess } from '@/lib/auth';
import { konveyerSnapshots } from '@/lib/konveyer';
import { buxgalteriyaData } from '@/lib/buxgalteriya';
import { buildFarmoyishForFirm } from '@/lib/farmoyish-docx';

export const runtime = 'nodejs';

// GET ?firmId= — bitta firmaning farmoyishi (.docx). firmId'siz — barcha firmalar (.zip, har firma alohida
// fayl; almashib ketmaydi). Tanlangan snapshot bo'yicha.
export async function GET(req: NextRequest) {
  await requireAccess('buxgalteriya');

  const snaps = await konveyerSnapshots().catch(() => []);
  const raw = cookies().get('konv_s')?.value;
  const parsed = raw ? Number(raw) : NaN;
  const selectedId = Number.isInteger(parsed) && parsed > 0 && snaps.some((s) => s.id === parsed) ? parsed : snaps[0]?.id;
  const sel = snaps.find((s) => s.id === selectedId);

  const fid = req.nextUrl.searchParams.get('firmId');

  // Bitta firma → to'g'ridan-to'g'ri .docx
  if (fid) {
    const res = await buildFarmoyishForFirm(Number(fid), selectedId);
    if (!res) return NextResponse.json({ error: 'Bu firmada kvitansiya yo‘q' }, { status: 404 });
    return new NextResponse(new Uint8Array(res.buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(res.fileName)}"`,
      },
    });
  }

  // Hammasi → har firma alohida .docx bo'lgan ZIP (fayllar aralashmaydi).
  const data = await buxgalteriyaData(selectedId);
  const docs = (await Promise.all(data.firms.map((f) => buildFarmoyishForFirm(f.firmId, selectedId)))).filter(
    (d): d is { buffer: Buffer; fileName: string } => d !== null,
  );
  if (docs.length === 0) return NextResponse.json({ error: 'Kvitansiya yo‘q' }, { status: 404 });

  const archive = archiver('zip', { store: true });
  const chunks: Buffer[] = [];
  archive.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve, reject) => {
    archive.on('end', () => resolve());
    archive.on('error', reject);
  });
  const seen = new Map<string, number>();
  for (const d of docs) {
    // Bir xil nomli (masalan sanasiz) fayllar ustma-ust tushmasin — takrorlansa suffiks.
    const nth = (seen.get(d.fileName) ?? 0) + 1;
    seen.set(d.fileName, nth);
    const name = nth === 1 ? d.fileName : d.fileName.replace(/\.docx$/, `_${nth}.docx`);
    archive.append(d.buffer, { name });
  }
  await archive.finalize();
  await done;

  const zipName = `Farmoyishlar_${sel?.label ?? ''}.zip`.replace(/\s+/g, '_');
  return new NextResponse(new Uint8Array(Buffer.concat(chunks)), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(zipName)}"`,
    },
  });
}
