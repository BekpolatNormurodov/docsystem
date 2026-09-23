import { NextRequest, NextResponse } from 'next/server';
import { requireAccess } from '@/lib/auth';
import { addPinflAndCheck, ensureManualReport } from '@/lib/mib/add-pinfl';
import { getMibConfig } from '@/lib/mib/config';
import { getT } from '@/lib/i18n/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

// POST { pinfl, fio?, force? } — EXCELSIZ bitta PINFL tekshirish. «Qo'lda tekshiruvlar» reportini
// topadi/yaratadi, PINFL'ni qo'shib darhol tekshiradi. Natija (ijro ishlari + tekshiruv sanasi) shu
// reportga yig'ilib saqlanadi.
//
// Qayta so'rov mantig'i (2026-09-23): default (force yo'q) — mavjud mijoz aynan shu PINFL bilan bo'lsa
// eski natijani QAYTARADI (reused=true + lastCheckedAt). UI shu response'ni ko'rib «Bu PINFL <sana>да
// tekshirilgan. Yangi dalniy olamizmi?» dialog ko'rsatadi; foydalanuvchi «Ha» desa force=true bilan
// qayta yuboradi. Eski nusxa arxivga ko'chadi (o'chirilmaydi — dinamika/audit uchun).
export async function POST(req: NextRequest) {
  const user = await requireAccess('mib-report');
  const t = getT();
  const body = await req.json().catch(() => ({}));
  // Yaroqsiz PINFL'da bo'sh «Qo'lda» report yaratilmasin — avval tekshiramiz.
  const pinfl = String(body?.pinfl ?? '').replace(/\D/g, '');
  if (pinfl.length !== 14) return NextResponse.json({ error: t('PINFL 14 ta raqamdan iborat boʻlishi kerak') }, { status: 400 });
  const reportId = await ensureManualReport(user.username);
  const force = !!body?.force;
  const res = await addPinflAndCheck(reportId, pinfl, (String(body?.fio ?? '').trim() || null), { force });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
  const cfg = await getMibConfig();
  return NextResponse.json({
    ok: true, reportId, clientId: res.clientId, running: res.running,
    reused: 'reused' in res ? res.reused === true : false,
    lastCheckedAt: 'lastCheckedAt' in res ? res.lastCheckedAt : null,
    cases: 'cases' in res ? res.cases : undefined,
    phoneConfigured: !!cfg.phone,
  });
}
