import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { parseDateParts } from '@/core/portfolio';

export const runtime = 'nodejs';

// Filename-only peek — never opens the file. Accepts either a multipart `file` field or a
// JSON { filename } body so the UI can call it right after a file is chosen, before upload.
export async function POST(req: NextRequest) {
  await requireAdmin();

  const contentType = req.headers.get('content-type') ?? '';
  let filename = '';

  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    filename = file?.name ?? '';
  } else {
    const body = await req.json().catch(() => ({}));
    filename = String(body.filename ?? '');
  }

  return NextResponse.json({ date: parseDateParts(filename) });
}
