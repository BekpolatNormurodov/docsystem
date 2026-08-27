import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requireAccess } from '@/lib/auth';
import { APP_DOCS_DIR, appDocsStatus, getAppDoc, setAppDoc, clearAppDoc, isAppDocKey } from '@/lib/app-docs';

export const runtime = 'nodejs';

const safe = (s: string) => s.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 120);
const MIME: Record<string, string> = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

// GET — barcha kerakli hujjatlar holati; GET ?download=talabnoma|sud → faylni oqim qilib beradi.
export async function GET(req: NextRequest) {
  await requireAccess('docs-manage');
  const dl = req.nextUrl.searchParams.get('download');
  if (dl) {
    if (!isAppDocKey(dl)) return NextResponse.json({ error: 'kind notoʻgʻri' }, { status: 400 });
    const doc = await getAppDoc(dl);
    if (!doc) return NextResponse.json({ error: 'Topilmadi' }, { status: 404 });
    let buf: Buffer;
    try { buf = await fs.readFile(doc.filePath); } catch { return NextResponse.json({ error: 'Fayl yoʻq' }, { status: 404 }); }
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

// POST multipart (kind: talabnoma|sud, file) — ixtiyoriy hujjatni yuklaydi/almashtiradi.
export async function POST(req: NextRequest) {
  await requireAccess('docs-manage');
  const form = await req.formData();
  const kind = String(form.get('kind') || '');
  const file = form.get('file');
  if (!isAppDocKey(kind)) return NextResponse.json({ error: 'kind notoʻgʻri' }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ error: 'fayl kerak' }, { status: 400 });
  // Faqat Excel (.xlsx) — 3 fayl ham Excel bo'lishi kerak (foydalanuvchi so'rovi).
  if (!/\.xlsx$/i.test(file.name)) return NextResponse.json({ error: 'Fayl .xlsx (Excel) boʻlishi kerak' }, { status: 415 });
  if (file.size > 25 * 1024 * 1024) return NextResponse.json({ error: 'Fayl 25MB dan katta' }, { status: 413 });

  await fs.mkdir(APP_DOCS_DIR, { recursive: true });
  const filePath = path.join(APP_DOCS_DIR, `${kind}-${Date.now()}-${safe(file.name || 'hujjat')}`);
  await fs.writeFile(filePath, Buffer.from(await file.arrayBuffer()));

  // Eski faylni yangisi yozilgandan keyin o'chiramiz (yozish muvaffaqiyatsiz bo'lsa eski qoladi).
  const prev = await getAppDoc(kind);
  await setAppDoc(kind, { label: file.name || kind, filePath, uploadedAt: new Date().toISOString(), size: file.size });
  if (prev?.filePath && prev.filePath !== filePath) await fs.rm(prev.filePath, { force: true }).catch(() => {});

  return NextResponse.json(await appDocsStatus());
}

// DELETE ?kind=talabnoma|sud — ixtiyoriy hujjatni olib tashlaydi.
export async function DELETE(req: NextRequest) {
  await requireAccess('docs-manage');
  const kind = String(req.nextUrl.searchParams.get('kind') || '');
  if (!isAppDocKey(kind)) return NextResponse.json({ error: 'kind notoʻgʻri' }, { status: 400 });
  await clearAppDoc(kind);
  return NextResponse.json(await appDocsStatus());
}
