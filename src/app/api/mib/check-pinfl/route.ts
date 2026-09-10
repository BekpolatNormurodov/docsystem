import { NextRequest, NextResponse } from 'next/server';
import { requireAccess } from '@/lib/auth';
import { addPinflAndCheck, ensureManualReport } from '@/lib/mib/add-pinfl';
import { getMibConfig } from '@/lib/mib/config';

export const runtime = 'nodejs';
export const maxDuration = 60;

// POST { pinfl } — EXCELSIZ bitta PINFL tekshirish. «Qo'lda tekshiruvlar» reportini topadi/yaratadi,
// PINFL'ni qo'shib darhol tekshiradi. Natija (ijro ishlari + tekshiruv sanasi) shu reportga yig'ilib
// saqlanadi. Qaytadi: reportId + clientId (mijoz sahifasini ochish uchun).
export async function POST(req: NextRequest) {
  const user = await requireAccess('mib-report');
  const body = await req.json().catch(() => ({}));
  // Yaroqsiz PINFL'da bo'sh «Qo'lda» report yaratilmasin — avval tekshiramiz.
  const pinfl = String(body?.pinfl ?? '').replace(/\D/g, '');
  if (pinfl.length !== 14) return NextResponse.json({ error: 'PINFL 14 ta raqamdan iborat boʻlishi kerak' }, { status: 400 });
  const reportId = await ensureManualReport(user.username);
  const res = await addPinflAndCheck(reportId, pinfl, (String(body?.fio ?? '').trim() || null));
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
  const cfg = await getMibConfig();
  return NextResponse.json({ ok: true, reportId, clientId: res.clientId, running: res.running, phoneConfigured: !!cfg.phone });
}
