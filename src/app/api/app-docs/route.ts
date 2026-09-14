import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requireAccess } from '@/lib/auth';
import { appDocsStatus, getAppDoc, isAppDocKey } from '@/lib/app-docs';
import { getT } from '@/lib/i18n/server';

export const runtime = 'nodejs';

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

// GET — barcha kerakli hujjatlar holati; GET ?download=talabnoma|sud → faylni oqim qilib beradi.
export async function GET(req: NextRequest) {
  await requireAccess('docs-manage');
  const t = getT();
  const dl = req.nextUrl.searchParams.get('download');
  if (dl) {
    if (!isAppDocKey(dl)) return NextResponse.json({ error: t('kind notoʻgʻri') }, { status: 400 });
    const doc = await getAppDoc(dl);
    if (!doc) return NextResponse.json({ error: t('Topilmadi') }, { status: 404 });
    let buf: Buffer;
    try { buf = await fs.readFile(doc.filePath); } catch { return NextResponse.json({ error: t('Fayl yoʻq') }, { status: 404 }); }
    const ext = path.extname(doc.filePath).toLowerCase();
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': MIME[ext] ?? 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(doc.label || dl)}"`,
      },
    });
  }
  return NextResponse.json(await appDocsStatus());
}

// QULF: hujjat paketi (talabnoma ro'yxati / sud hujjati) UI orqali O'ZGARTIRILMAYDI/O'CHIRILMAYDI —
// admin ham. Bir marta yuklangach qat'iy saqlanadi (filtrlar shundan ishlaydi). O'zgartirish FAQAT
// to'g'ridan-to'g'ri kod/DB orqali (Setting + exports/app-docs). POST/DELETE bloklangan (403).
const locked = (t: (uz: string) => string) =>
  NextResponse.json({ error: t('Hujjat qulflangan — UI orqali o‘zgartirib/o‘chirib bo‘lmaydi (faqat kod/DB orqali).') }, { status: 403 });

// POST — QULF: yuklash/almashtirish yo'q (403). O'zgartirish faqat kod/DB orqali.
export async function POST() {
  await requireAccess('docs-manage');
  return locked(getT());
}

// DELETE — QULF: o'chirish yo'q (403). Admin ham. Faqat kod/DB orqali.
export async function DELETE() {
  await requireAccess('docs-manage');
  return locked(getT());
}
