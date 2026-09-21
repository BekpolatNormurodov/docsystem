// Snapshot'ning 3 ta manba .xlsx'ini yuklab olish uchun servedan streaming route.
//   kind='portfel'   → uploads/{id}.xlsx (majburiy, portfel)
//   kind='sud'       → uploads/{id}-exclude.xlsx (sud ro'yxati / istisnodagilar)
//   kind='talabnoma' → global appDoc.talabnoma (Setting orqali saqlanadi, snapshot'ga bog'liq emas)
// Faqat «Hujjatlar boshqaruvi» ruxsatli user (yoki ADMIN) — portfel ichida PINFL bor.
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { canManageDocs } from '@/lib/access';
import { prisma } from '@/lib/db';
import { getAppDoc } from '@/lib/app-docs';
import { getT } from '@/lib/i18n/server';

export const runtime = 'nodejs';

const KINDS = ['portfel', 'sud', 'talabnoma'] as const;
type Kind = (typeof KINDS)[number];
const isKind = (v: string): v is Kind => (KINDS as readonly string[]).includes(v);

export async function GET(_req: NextRequest, { params }: { params: { id: string; kind: string } }) {
  const user = await requireUser();
  const t = getT();
  if (!canManageDocs(user)) return NextResponse.json({ error: t('Ruxsat yo‘q') }, { status: 403 });

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: t('id noto‘g‘ri') }, { status: 400 });
  if (!isKind(params.kind)) return NextResponse.json({ error: t('Noto‘g‘ri kind') }, { status: 400 });

  const snap = await prisma.snapshot.findUnique({ where: { id }, select: { id: true, reportDate: true } });
  if (!snap) return NextResponse.json({ error: t('Snapshot topilmadi') }, { status: 404 });

  const uploads = path.join(process.cwd(), 'uploads');
  const iso = snap.reportDate.toISOString().slice(0, 10);

  let abs = '';
  let downloadName = '';
  if (params.kind === 'portfel') {
    abs = path.join(uploads, `${id}.xlsx`);
    downloadName = `${iso}-1-Portfel.xlsx`;
  } else if (params.kind === 'sud') {
    abs = path.join(uploads, `${id}-exclude.xlsx`);
    downloadName = `${iso}-2-Sud-royxati.xlsx`;
  } else {
    // Talabnoma — global appDoc; snapshot'ga bog'liq emas, lekin nom hisobot sanasi bilan berilsin.
    const meta = await getAppDoc('talabnoma');
    if (!meta?.filePath) return NextResponse.json({ error: t('Talabnoma ro‘yxati yuklanmagan') }, { status: 404 });
    abs = meta.filePath;
    const base = (meta.label || 'talabnoma.xlsx').replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 60);
    downloadName = `${iso}-3-Talabnoma-${base}`;
  }

  let st: fs.Stats;
  try {
    st = fs.statSync(abs);
  } catch {
    return NextResponse.json({ error: t('Fayl diskda yo‘q') }, { status: 404 });
  }

  const stream = fs.createReadStream(abs);
  // Web ReadableStream'ga wrap qilamiz (Next 14 fetch response node stream'ni qabul qilmaydi).
  const web = new ReadableStream({
    start(controller) {
      stream.on('data', (chunk) => controller.enqueue(chunk));
      stream.on('end', () => controller.close());
      stream.on('error', (err) => controller.error(err));
    },
    cancel() {
      stream.destroy();
    },
  });

  return new NextResponse(web, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Length': String(st.size),
      'Content-Disposition': `attachment; filename="${downloadName}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
