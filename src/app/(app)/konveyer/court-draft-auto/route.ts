import { NextRequest, NextResponse } from 'next/server';
import { requireStep } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { isDraftAutoOn, setDraftAuto } from '@/lib/court-draft-auto';
import { courtReadiness } from '@/lib/court-ready';
import { pausedFirmIds } from '@/lib/cabinet/pacer';
import { audit, AuditAction } from '@/lib/audit';
import { getT } from '@/lib/i18n/server';

export const runtime = 'nodejs';

// Partiya turi — Job.params'dan (2026-09-19, /sud 3-tab). Bir vaqtda BITTA COURT_SUBMIT job
// ishlaydi (Go ham, qo'lda qoralama ham, 3-tab yuborishi ham) — operator panelda aynan QAYSI
// biri ketayotganini ko'rsin: ilgari faqat draftMode qaralardi va Go (suitMode) partiyasi ham,
// real yuborish ham bir xil ko'rinardi.
type JobKind = 'draft' | 'suit' | 'real' | 'send';
function jobKind(params: unknown): JobKind {
  const p = (params ?? {}) as { draftMode?: boolean; suitMode?: boolean; sendSuits?: boolean };
  if (p.sendSuits === true) return 'send';
  if (p.suitMode === true) return 'suit';
  if (p.draftMode === true) return 'draft';
  return 'real';
}

// GET — 24/7 avto-qoralama holati + monitoring (firma va sud kesimida).
//
// YAGONA HAQIQAT MANBASI: firma VA sud tallilari asosiy «/sud» sahifasi bilan AYNI
// `courtReadiness`dan olinadi. Qoralama tayyor / qo'lda-yurist yuborgan / biz yuborgan
// holatlari bir xil `flagsFor`dan hisoblanadi — shuning uchun bu panel va asosiy sahifa
// HECH QACHON zid bo'lmaydi (`submitted` KENG: biz yuborgan + yurist portalda qo'lda kiritgan).
export async function GET() {
  await requireStep('sud:send');
  const t = getT();

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
  const activeKind = activeJob ? jobKind(activeJob.params) : null;

  const [courtList, readiness, pausedFirms, recentJobs, nextRow] = await Promise.all([
    prisma.court.findMany({ select: { id: true, shortName: true } }),
    courtReadiness(snap?.id).catch(() => null),
    pausedFirmIds().then((ids) => new Set(ids)),
    // Firma bo'yicha OXIRGI TUGAGAN qoralama/suit partiyasi — Go natijasi hech qayerda ko'rinmasdi
    // (fatal xato: sessiya tugagan, claimant yo'q — faqat Job.message'da qolardi). draftAutoTick
    // «buzuq firma»ni ham xuddi shu oxirgi 40 ta job'dan aniqlaydi.
    prisma.job.findMany({
      where: { type: 'COURT_SUBMIT', status: { in: ['DONE', 'FAILED', 'CANCELED'] } },
      orderBy: { id: 'desc' }, take: 60,
      select: { id: true, status: true, message: true, total: true, progress: true, params: true, updatedAt: true },
    }).catch(() => []),
    // Portal bloklagandan keyingi kutish (court-auto-resume noteQueueBlocked yozadi). UI'da
    // umuman ko'rinmasdi — navbat «qotib qolgan»dek tuyulardi.
    prisma.setting.findUnique({ where: { key: 'court_queue_next_attempt' }, select: { value: true } }).catch(() => null),
  ]);
  const lastBatchByFirm = new Map<number, { jobId: number; kind: JobKind; status: string; message: string | null; total: number; progress: number; finishedAt: string }>();
  for (const j of recentJobs) {
    const kind = jobKind(j.params);
    if (kind !== 'suit' && kind !== 'draft') continue; // faqat qoralama partiyalari
    const fid = Number((j.params as { firmId?: number } | null)?.firmId);
    if (!Number.isInteger(fid) || lastBatchByFirm.has(fid)) continue; // eng yangisi (id desc)
    lastBatchByFirm.set(fid, { jobId: j.id, kind, status: j.status, message: j.message ?? null, total: j.total, progress: j.progress, finishedAt: j.updatedAt.toISOString() });
  }
  const nextAt = nextRow?.value ? Date.parse(nextRow.value) : NaN;
  const backoff = { nextAttemptAt: Number.isFinite(nextAt) && nextAt > Date.now() ? new Date(nextAt).toISOString() : null };
  const courtName = new Map(courtList.map((c) => [c.id, c.shortName]));
  const firmName = new Map((readiness?.firms ?? []).map((f) => [f.firmId, f.firmName]));

  const firmRows = (readiness?.firms ?? [])
    .map((f) => ({ firmId: f.firmId, firmName: f.firmName, total: f.total, draftReady: f.draftReady, submitted: f.submitted, queued: f.queued, sendable: f.sendable, active: f.firmId === activeFirmId, paused: pausedFirms.has(f.firmId), lastBatch: lastBatchByFirm.get(f.firmId) ?? null }))
    .sort((a, b) => b.sendable - a.sendable || b.draftReady - a.draftReady || b.total - a.total);
  const courtRows = (readiness?.courts ?? [])
    .map((c) => ({ courtId: c.courtId, courtName: courtName.get(c.courtId) ?? `${t('Sud')} ${c.courtId}`, total: c.total, draftReady: c.draftReady, submitted: c.submitted, queued: c.queued, sendable: c.sendable }))
    .sort((a, b) => b.sendable - a.sendable || b.draftReady - a.draftReady || b.total - a.total);

  return NextResponse.json({
    on,
    active: activeJob
      // `draftMode` — eski maydon (moslik uchun): endi «sudga yubormaydigan» partiya (draft|suit).
      ? { jobId: activeJob.id, status: activeJob.status, progress: activeJob.progress, total: activeJob.total, firmId: activeFirmId, firmName: activeFirmId ? firmName.get(activeFirmId) ?? null : null, kind: activeKind, draftMode: activeKind === 'draft' || activeKind === 'suit', message: activeJob.message ?? null }
      : null,
    firms: firmRows,
    courts: courtRows,
    backoff,
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
