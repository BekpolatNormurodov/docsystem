import { NextRequest, NextResponse } from 'next/server';
import { requireStep } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { isDraftAutoOn, setDraftAuto } from '@/lib/court-draft-auto';
import { courtReadiness } from '@/lib/court-ready';
import { audit, AuditAction } from '@/lib/audit';

export const runtime = 'nodejs';

// GET — 24/7 avto-qoralama holati + monitoring (firma va sud kesimida).
//
// YAGONA HAQIQAT MANBASI: firma VA sud tallilari asosiy «/sud» sahifasi bilan AYNI
// `courtReadiness`dan olinadi. Qoralama tayyor / qo'lda-yurist yuborgan / biz yuborgan
// holatlari bir xil `flagsFor`dan hisoblanadi — shuning uchun bu panel va asosiy sahifa
// HECH QACHON zid bo'lmaydi (`submitted` KENG: biz yuborgan + yurist portalda qo'lda kiritgan).
export async function GET() {
  await requireStep('sud:send');

  const [on, snap] = await Promise.all([
    isDraftAutoOn(),
    prisma.snapshot.findFirst({ orderBy: { reportDate: 'desc' }, select: { id: true } }),
  ]);

  // Ayni paytda ketayotgan COURT_SUBMIT partiyasi (real yoki qoralama).
  const activeJob = await prisma.job.findFirst({
    where: { type: 'COURT_SUBMIT', status: { in: ['PENDING', 'RUNNING'] } },
    orderBy: { id: 'desc' },
    select: { id: true, status: true, progress: true, total: true, params: true, message: true },
  });
  const activeFirmId = Number((activeJob?.params as { firmId?: number } | null)?.firmId) || null;
  const activeDraft = (activeJob?.params as { draftMode?: boolean } | null)?.draftMode === true;

  const [courtList, readiness] = await Promise.all([
    prisma.court.findMany({ select: { id: true, shortName: true } }),
    courtReadiness(snap?.id).catch(() => null),
  ]);
  const courtName = new Map(courtList.map((c) => [c.id, c.shortName]));
  const firmName = new Map((readiness?.firms ?? []).map((f) => [f.firmId, f.firmName]));

  const firmRows = (readiness?.firms ?? [])
    .map((f) => ({ firmId: f.firmId, firmName: f.firmName, total: f.total, draftReady: f.draftReady, submitted: f.submitted, queued: f.queued, sendable: f.sendable, active: f.firmId === activeFirmId }))
    .sort((a, b) => b.sendable - a.sendable || b.draftReady - a.draftReady || b.total - a.total);
  const courtRows = (readiness?.courts ?? [])
    .map((c) => ({ courtId: c.courtId, courtName: courtName.get(c.courtId) ?? `Sud ${c.courtId}`, total: c.total, draftReady: c.draftReady, submitted: c.submitted, queued: c.queued, sendable: c.sendable }))
    .sort((a, b) => b.sendable - a.sendable || b.draftReady - a.draftReady || b.total - a.total);

  return NextResponse.json({
    on,
    active: activeJob
      ? { jobId: activeJob.id, status: activeJob.status, progress: activeJob.progress, total: activeJob.total, firmId: activeFirmId, firmName: activeFirmId ? firmName.get(activeFirmId) ?? null : null, draftMode: activeDraft, message: activeJob.message ?? null }
      : null,
    firms: firmRows,
    courts: courtRows,
  });
}

// POST { on: boolean } — 24/7 avto-qoralama'ni yoqish/o'chirish (admin, sud bo'limi).
export async function POST(req: NextRequest) {
  await requireStep('sud:send');
  const body = await req.json().catch(() => ({}));
  const on = body?.on === true;
  await setDraftAuto(on);
  await audit(AuditAction.COURT_SUBMIT, {
    target: 'court-draft-auto',
    detail: { amal: on ? '24/7 avto-qoralama YOQILDI' : '24/7 avto-qoralama o‘chirildi' },
  });
  return NextResponse.json({ on });
}
