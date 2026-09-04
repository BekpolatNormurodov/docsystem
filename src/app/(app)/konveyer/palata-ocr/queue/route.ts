import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requireUser } from '@/lib/auth';
import { QUEUE_DIR, pdfPageCount } from '@/lib/palata-ocr';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Navbat fayllari nomi: `<vaqt(ms)>-<NNN>-<asl nom>`. Prefiksdan vaqt + asl nomni ajratamiz.
const parse = (fname: string): { uploadedAt: number | null; name: string } => {
  const m = fname.match(/^(\d+)-\d{3}-(.+)$/);
  return m ? { uploadedAt: Number(m[1]), name: m[2] } : { uploadedAt: null, name: fname };
};

// Sahifa sonini qayta-qayta hisoblamaslik uchun oddiy kesh (fayl nomi → sahifa).
const pageCache = new Map<string, number>();

// GET → navbat ro'yxati. Birinchi (nom bo'yicha eng eski) fayl — HOZIR o'qilayotgan
// (drainer uni OCR tugagach SCAN_STORE'ga ko'chiradi), qolganlari — navbatda kutayotgan.
export async function GET() {
  await requireUser();
  let files: string[] = [];
  try { files = (await fs.readdir(QUEUE_DIR)).filter((f) => /\.pdf$/i.test(f)).sort(); } catch { files = []; }
  const items = await Promise.all(files.map(async (f, i) => {
    const { uploadedAt, name } = parse(f);
    let pages = pageCache.get(f);
    if (pages === undefined) { pages = await pdfPageCount(path.join(QUEUE_DIR, f)); pageCache.set(f, pages); }
    return { file: f, name, uploadedAt, pages, active: i === 0 };
  }));
  // Keshni navbatda yo'q fayllardan tozalab turamiz (xotira o'smasin).
  for (const k of pageCache.keys()) if (!files.includes(k)) pageCache.delete(k);
  return NextResponse.json({ items });
}

// DELETE ?file=<name> → NAVBATDAGI (hali o'qilmagan) bitta faylni o'chiradi. Hozir
// o'qilayotgan (birinchi) faylni bu yerdan o'chirmaymiz — uni «Bekor qilish» to'xtatadi.
export async function DELETE(req: NextRequest) {
  await requireUser();
  const file = req.nextUrl.searchParams.get('file') || '';
  // Xavfsizlik: faqat toza fayl nomi (papkadan chiqib ketmasin).
  if (!file || file.includes('/') || file.includes('..')) return NextResponse.json({ error: 'Nomaʼqul fayl' }, { status: 400 });
  let files: string[] = [];
  try { files = (await fs.readdir(QUEUE_DIR)).filter((f) => /\.pdf$/i.test(f)).sort(); } catch { files = []; }
  if (files[0] === file) return NextResponse.json({ error: 'Bu fayl hozir oʻqilyapti — «Bekor qilish» bilan toʻxtating' }, { status: 409 });
  if (!files.includes(file)) return NextResponse.json({ removed: 0 });
  await fs.rm(path.join(QUEUE_DIR, file), { force: true }).catch(() => {});
  pageCache.delete(file);
  return NextResponse.json({ removed: 1 });
}
