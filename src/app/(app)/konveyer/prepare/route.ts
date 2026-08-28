import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { enqueueJob } from '@/lib/job-dispatch';
import { firmCourtBudgets } from '@/lib/court-routing';
import type { CaseStage } from '@prisma/client';

export const runtime = 'nodejs';

const VALID_STAGES = new Set<string>(['IMPORTED', 'TALABNOMA_SENT', 'ARIZA_GENERATED', 'PRINTED', 'CHAMBER_SENT', 'CHAMBER_RETURNED', 'SIGNED_SCANNED', 'INVOICE_CREATED', 'INVOICE_PAID', 'COURT_SUBMITTED', 'COURT_ACCEPTED', 'COURT_RETURNED', 'MIB_SUBMITTED', 'CLOSED']);

const numArg = (v: unknown): number | undefined => { const n = Number(v); return v != null && v !== '' && Number.isInteger(n) && n > 0 ? n : undefined; };

/** Newest still-running job of a type for a scope — so the UI can RECONNECT its progress after a
 *  page reload instead of losing it. Matches firmId inside params (JSON); an optional param flag
 *  (e.g. 'arizaOnly') further narrows PACKET jobs. */
async function findActiveJob(type: 'PACKET' | 'OFERTA', snapshotId?: number, firmId?: number, requireFlag?: string): Promise<{ id: number; progress: number; total: number } | null> {
  const jobs = await prisma.job.findMany({
    where: { type, status: { in: ['PENDING', 'RUNNING'] }, ...(snapshotId ? { snapshotId } : {}) },
    orderBy: { id: 'desc' }, take: 12, select: { id: true, progress: true, total: true, params: true },
  }).catch(() => []);
  const j = jobs.find((x) => {
    const p = (x.params ?? {}) as Record<string, unknown>;
    if (requireFlag && p[requireFlag] !== true) return false;
    // firmId null (Hamma firma) matches a job with no firmId; a specific firm matches its own job.
    return firmId == null ? p.firmId == null : Number(p.firmId) === firmId;
  });
  return j ? { id: j.id, progress: j.progress, total: j.total } : null;
}

// GET ?snapshotId=&firmId=&stages= — cheap case count for the scope, so «Ariza yaratish» can show
// «Hammasi (N)» / the count modal before starting the (heavy) packet job.
export async function GET(req: NextRequest) {
  await requireUser();
  const sp = req.nextUrl.searchParams;
  const snapshotId = numArg(sp.get('snapshotId'));
  const firmId = numArg(sp.get('firmId'));
  const stages = (sp.get('stages') || '').split(',').filter((s) => VALID_STAGES.has(s)) as CaseStage[];
  const where = {
    ...(snapshotId ? { snapshotId } : {}),
    ...(firmId ? { firmId } : {}),
    ...(stages.length ? { stage: { in: stages } } : {}),
  };
  const arizaOnly = sp.get('arizaOnly') === '1';
  const ofertaOnly = sp.get('ofertaOnly') === '1';
  const total = await prisma.arizaCase.count({ where });
  // «Ariza/Oferta yaratish»: allaqachon chiqarilganlar (arizaAt/ofertaAt != null) qayta chiqmaydi —
  // `remaining` = hali chiqmaganlar, `done` = tayyor bo'lganlar.
  let remaining = total;
  let done = 0;
  if (arizaOnly || ofertaOnly) {
    remaining = await prisma.arizaCase.count({ where: { ...where, ...(arizaOnly ? { arizaAt: null } : { ofertaAt: null }) } });
    done = total - remaining;
  }
  // Reload'da davom etayotgan jobga qayta ulanish uchun: shu qamrovdagi ishlab turgan job.
  const activeJob = arizaOnly ? await findActiveJob('PACKET', snapshotId, firmId, 'arizaOnly')
    : ofertaOnly ? await findActiveJob('OFERTA', snapshotId, firmId)
    : null;
  // Firma tanlangan bo'lsa — uning sud(lar)i (ariza yaratishda sudni tanlab, sonlarini belgilash uchun).
  // Bir nechta sud bo'lsa (Bright) — UI har biriga son kiritish maydonini ko'rsatadi.
  let courts: { id: number; shortName: string; dailyQuota: number; cutoffMinutes: number; remaining: number; open: boolean }[] = [];
  if (firmId) {
    courts = (await firmCourtBudgets(firmId).catch(() => [])).map((b) => ({
      id: b.court.id, shortName: b.court.shortName, dailyQuota: b.court.dailyQuota,
      cutoffMinutes: b.court.cutoffMinutes, remaining: b.remaining, open: b.window.open,
    }));
  }
  return NextResponse.json({ total, remaining, done, activeJob, courts });
}

// POST { snapshotId?, firmId?, stages?, talabnomaPdf? } — «Tayyorlash»: start a
// background job that builds the full packet for every case in scope into one ZIP.
// Returns { jobId, total }; the client polls /api/jobs/{jobId} and downloads
// /api/export/{jobId}/download when DONE.
export async function POST(req: NextRequest) {
  await requireUser();
  const body = await req.json().catch(() => ({}));

  const num = (v: unknown): number | undefined => { const n = Number(v); return v != null && v !== '' && Number.isInteger(n) && n > 0 ? n : undefined; };
  const snapshotId = num(body?.snapshotId);
  const firmId = num(body?.firmId);
  const stages = (Array.isArray(body?.stages) ? body.stages : []).filter((s: unknown) => typeof s === 'string' && VALID_STAGES.has(s)) as CaseStage[];
  const talabnomaPdf = body?.talabnomaPdf !== false;
  const limit = num(body?.limit);            // «belgilangan son» — build only the first N
  const arizaOnly = body?.arizaOnly === true; // «Arizani tayyorlash» — only the ariza per client

  // Require a narrowing scope so a stray body can't queue the whole table.
  if (snapshotId === undefined && firmId === undefined && stages.length === 0) {
    return NextResponse.json({ error: 'snapshotId yoki firmId/stages kerak' }, { status: 400 });
  }

  const where = {
    ...(snapshotId ? { snapshotId } : {}),
    ...(firmId ? { firmId } : {}),
    ...(stages.length ? { stage: { in: stages } } : {}),
    // «Ariza yaratish»: allaqachon arizasi bor case'lar QAYTA chiqmaydi (foydalanuvchi so'rovi).
    ...(arizaOnly ? { arizaAt: null } : {}),
  };
  const scopeTotal = await prisma.arizaCase.count({ where });
  if (scopeTotal === 0) return NextResponse.json({ error: arizaOnly ? 'Yangi ariza yoʻq — hammasi tayyor' : 'Bu tanlovda case yoʻq' }, { status: 400 });

  // ── Sud bo'yicha taqsimlash (ariza yaratishda sudni tanlab, son belgilash) ─────────────────────
  // courtCounts=[{courtId, count}] berilsa: eng eski case'larni tanlab, har sudga o'z sonicha
  // courtId biriktiramiz (ariza o'sha sud nomiga chiqadi). Aynan shu case'lar ZIP'ga yig'iladi.
  const rawCounts = Array.isArray(body?.courtCounts) ? body.courtCounts : [];
  const counts = rawCounts
    .map((c: unknown) => ({ courtId: Number((c as { courtId?: unknown })?.courtId), count: Math.max(0, Math.floor(Number((c as { count?: unknown })?.count)) || 0) }))
    .filter((c: { courtId: number; count: number }) => Number.isInteger(c.courtId) && c.courtId > 0 && c.count > 0);

  let jobParams: Record<string, unknown> = { snapshotId, firmId, stages, talabnomaPdf, limit, arizaOnly };
  let total = limit && limit < scopeTotal ? limit : scopeTotal;

  if (counts.length) {
    const need = counts.reduce((s: number, c: { count: number }) => s + c.count, 0);
    const picked = await prisma.arizaCase.findMany({ where, orderBy: [{ dueAt: 'asc' }, { id: 'asc' }], take: need, select: { id: true } });
    const q = picked.map((p) => p.id);
    const assignments: { caseId: number; courtId: number }[] = [];
    for (const c of counts) { let take = Math.min(c.count, q.length); while (take-- > 0) assignments.push({ caseId: q.shift()!, courtId: c.courtId }); }
    if (assignments.length === 0) return NextResponse.json({ error: 'Tanlangan sonlar bo‘yicha case yo‘q' }, { status: 400 });
    await prisma.$transaction(assignments.map((a) => prisma.arizaCase.update({ where: { id: a.caseId }, data: { courtId: a.courtId } })));
    const caseIds = assignments.map((a) => a.caseId);
    total = caseIds.length;
    jobParams = { snapshotId, firmId, caseIds, talabnomaPdf, arizaOnly };
  }

  const job = await prisma.job.create({
    data: { type: 'PACKET', status: 'PENDING', snapshotId: snapshotId ?? null, total, params: jobParams as never },
  });

  // Run inline (default) or leave PENDING for the Docker worker (JOB_MODE=worker); the client polls the Job.
  enqueueJob(job.id);

  return NextResponse.json({ jobId: job.id, total });
}
