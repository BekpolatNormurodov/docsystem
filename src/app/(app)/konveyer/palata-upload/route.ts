import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requireAdmin } from '@/lib/auth';

export const runtime = 'nodejs';

// Palata "inbox": scanned signed-ariza PDFs uploaded in bulk here, awaiting
// split/assignment to cases. Stored on disk (exports/palata-inbox).
const DIR = path.join(process.cwd(), 'exports', 'palata-inbox');
const safe = (s: string) => s.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 120);

export async function GET() {
  await requireAdmin();
  await fs.mkdir(DIR, { recursive: true });
  const names = await fs.readdir(DIR).catch(() => [] as string[]);
  const files = await Promise.all(
    names.map(async (name) => {
      const st = await fs.stat(path.join(DIR, name)).catch(() => null);
      return st ? { name, size: st.size, at: st.mtime.toISOString() } : null;
    }),
  );
  return NextResponse.json({ files: files.filter(Boolean).sort((a: any, b: any) => b.at.localeCompare(a.at)) });
}

// POST multipart (file, or multiple "files") — store scans into the inbox.
export async function POST(req: NextRequest) {
  await requireAdmin();
  await fs.mkdir(DIR, { recursive: true });
  const form = await req.formData();
  const items = [...form.getAll('files'), ...form.getAll('file')].filter((x): x is File => x instanceof File);
  if (items.length === 0) return NextResponse.json({ error: 'Fayl kerak' }, { status: 400 });
  if (items.length > 50) return NextResponse.json({ error: 'Bir martada 50 tadan ko‘p fayl bo‘lmasin' }, { status: 400 });
  if (items.some((f) => f.size > 50 * 1024 * 1024)) return NextResponse.json({ error: 'Fayl 50MB dan katta' }, { status: 413 });
  let saved = 0;
  for (const file of items) {
    const buf = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(path.join(DIR, `${Date.now()}-${saved}-${safe(file.name || 'skan.pdf')}`), buf);
    saved++;
  }
  return NextResponse.json({ saved });
}

export async function DELETE(req: NextRequest) {
  await requireAdmin();
  const name = req.nextUrl.searchParams.get('name');
  if (!name) return NextResponse.json({ error: 'name kerak' }, { status: 400 });
  await fs.rm(path.join(DIR, path.basename(name)), { force: true }).catch(() => {});
  return NextResponse.json({ ok: true });
}
