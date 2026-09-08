import { NextRequest, NextResponse } from 'next/server';
import { requireStep } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { isDraftAutoOn, setDraftAuto } from '@/lib/court-draft-auto';
import { audit, AuditAction } from '@/lib/audit';

export const runtime = 'nodejs';

const hasKey = (meta: unknown, key: string): boolean =>
  !!meta && typeof meta === 'object' && !Array.isArray(meta) && (meta as Record<string, unknown>)[key] != null;

// GET — 24/7 avto-qoralama holati + monitoring (firma va sud kesimida).
//
// Operator «sud bo'limi»da ko'radi: qoralama uzluksiz ishlayaptimi, hozir qaysi firma
// ketmoqda, va har firma/sud bo'yicha nechta qoralama tayyor / nechtasi sudda.
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

  // Bitta o'tishda barcha case'lar (oxirgi snapshot) — firma va sud kesimida tallilaymiz.
  const cases = await prisma.arizaCase.findMany({
    where: snap ? { snapshotId: snap.id } : {},
    select: { id: true, firmId: true, courtId: true, stage: true, courtCaseId: true, meta: true },
  });
  const queued = new Set(
    (await prisma.courtQueueItem.findMany({ where: { state: { in: ['PENDING', 'RUNNING'] } }, select: { caseId: true } })).map((q) => q.caseId),
  );

  const [firms, courts] = await Promise.all([
    prisma.firm.findMany({ select: { id: true, shortName: true } }),
    prisma.court.findMany({ select: { id: true, shortName: true } }),
  ]);
  const firmName = new Map(firms.map((f) => [f.id, f.shortName]));
  const courtName = new Map(courts.map((c) => [c.id, c.shortName]));

  type Tally = { total: number; draftReady: number; submitted: number; queued: number };
  const mk = (): Tally => ({ total: 0, draftReady: 0, submitted: 0, queued: 0 });
  const byFirm = new Map<number, Tally>();
  const byCourt = new Map<number, Tally>();
  const bump = (m: Map<number, Tally>, key: number | null, add: (t: Tally) => void) => {
    if (key == null) return;
    const t = m.get(key) ?? mk();
    add(t);
    m.set(key, t);
  };

  for (const c of cases) {
    const SENT = ['COURT_SUBMITTED', 'COURT_ACCEPTED', 'MIB_SUBMITTED', 'CLOSED'];
    const submitted = SENT.includes(String(c.stage)) || !!c.courtCaseId;
    const draftReady = !submitted && hasKey(c.meta, 'draftReadyAt');
    const inQueue = queued.has(c.id);
    const add = (t: Tally) => { t.total++; if (submitted) t.submitted++; else if (draftReady) t.draftReady++; if (inQueue) t.queued++; };
    bump(byFirm, c.firmId, add);
    bump(byCourt, c.courtId, add);
  }

  const firmRows = [...byFirm.entries()]
    .map(([id, t]) => ({ firmId: id, firmName: firmName.get(id) ?? `Firma ${id}`, ...t, active: id === activeFirmId }))
    .sort((a, b) => b.draftReady - a.draftReady || b.total - a.total);
  const courtRows = [...byCourt.entries()]
    .map(([id, t]) => ({ courtId: id, courtName: courtName.get(id) ?? `Sud ${id}`, ...t }))
    .sort((a, b) => b.draftReady - a.draftReady || b.total - a.total);

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
