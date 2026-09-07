import { NextRequest, NextResponse } from 'next/server';
import { requireStep } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { enqueueJob } from '@/lib/job-dispatch';
import { FIRM_REQUIRED_DOCS, FIRM_DOC_LABEL } from '@/lib/court-ready';
import { isQueuePaused } from '@/lib/cabinet/pacer';

export const runtime = 'nodejs';

// POST { firmId, limit? } — navbatda QOLGAN ishlarni davom ettirish.
//
// «Sudga yuborish» partiya tanlashdan boshlanadi (tayyor ishlardan N ta). Bu esa boshqa
// holat: partiya allaqachon tuzilgan, bir qismi ketgan, qolgani `CourtQueueItem` da PENDING
// bo'lib turibdi (worker uzilgani, pauza yoki sahifa yangilangani sababli). Bunda YANGI
// tanlov qilinmaydi — aynan o'sha qolgan ishlar davom ettiriladi, tartibi buzilmaydi va
// hech narsa takrorlanmaydi.
export async function POST(req: NextRequest) {
  await requireStep('sud:send');
  const body = await req.json().catch(() => ({}));
  const firmId = Number(body?.firmId);
  if (!Number.isInteger(firmId) || firmId <= 0) {
    return NextResponse.json({ error: 'firmId kerak' }, { status: 400 });
  }

  if (await isQueuePaused()) {
    return NextResponse.json(
      { error: 'Sudga yuborish jarayoni pauzada. Avval «Davom ettirish» tugmasi bilan yoqing.' },
      { status: 409 },
    );
  }

  // Firma hujjatlari to'liq bo'lmasa davom ettirmaymiz — paket chala ketmasin
  // (prepare-ready bilan bir xil shart).
  const haveDocs = new Set(
    (await prisma.firmDocument.findMany({ where: { firmId }, select: { kind: true } })).map((d) => String(d.kind)),
  );
  const missDocs = FIRM_REQUIRED_DOCS.filter((k) => !haveDocs.has(k));
  if (missDocs.length) {
    return NextResponse.json(
      { error: `Firma hujjatlari yetishmaydi: ${missDocs.map((k) => FIRM_DOC_LABEL[k] ?? k).join(', ')}.` },
      { status: 400 },
    );
  }

  const limit = Math.min(100, Math.max(1, Number(body?.limit) || 100));
  const items = await prisma.courtQueueItem.findMany({
    where: { firmId, state: { in: ['PENDING', 'RUNNING'] } },
    select: { caseId: true },
    orderBy: { id: 'asc' },
    take: limit,
  });
  if (!items.length) {
    return NextResponse.json({ error: 'Bu firmada navbatda qolgan ish yo‘q' }, { status: 400 });
  }

  const caseIds = items.map((i) => i.caseId);
  const snap = await prisma.snapshot.findFirst({ orderBy: { reportDate: 'desc' }, select: { id: true } });

  const job = await prisma.job.create({
    data: {
      type: 'COURT_SUBMIT',
      status: 'PENDING',
      snapshotId: snap?.id ?? null,
      total: caseIds.length,
      params: { firmId, snapshotId: snap?.id, caseIds, ready: true, talabnomaPdf: true, includeGrafik: false, markExported: true },
    },
  });
  enqueueJob(job.id);

  return NextResponse.json({ jobId: job.id, type: 'COURT_SUBMIT', total: caseIds.length, resumed: true });
}
