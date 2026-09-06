import { NextRequest, NextResponse } from 'next/server';
import { requireStep } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';

const num = (v: string | null): number | undefined => {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

// GET ?firmId= — sudga yuborish navbatining HAR BIR ISH bo'yicha holati.
//
// Job (batch) darajasidagi progress «3/100» deydi, lekin QAYSI ish yiqilgani va NEGA —
// ko'rinmaydi. Operatorga aynan shu kerak: xato bergan ishni ochib, sababini o'qib, tuzatib
// qayta yuborishi uchun. Xato bergan ishlar birinchi chiqadi.
export async function GET(req: NextRequest) {
  await requireStep('sud');
  const firmId = num(req.nextUrl.searchParams.get('firmId'));
  if (!firmId) return NextResponse.json({ error: 'firmId kerak' }, { status: 400 });

  const items = await prisma.courtQueueItem.findMany({
    where: { firmId },
    orderBy: [{ updatedAt: 'desc' }],
    take: 300,
    select: {
      caseId: true, state: true, lastError: true, draftId: true, caseNumber: true,
      attempts: true, startedAt: true, finishedAt: true,
      case: { select: { clientName: true, pinfl: true } },
    },
  });

  const counts = { PENDING: 0, RUNNING: 0, DONE: 0, FAILED: 0, SKIPPED: 0 } as Record<string, number>;
  for (const it of items) counts[it.state] = (counts[it.state] ?? 0) + 1;

  // Xatolar tepada: operator birinchi navbatda shularni ko'rishi kerak.
  const rank: Record<string, number> = { FAILED: 0, RUNNING: 1, PENDING: 2, DONE: 3, SKIPPED: 4 };
  const rows = items
    .map((it) => ({
      caseId: it.caseId,
      clientName: it.case?.clientName ?? null,
      pinfl: it.case?.pinfl ?? null,
      state: it.state,
      error: it.lastError,
      draftId: it.draftId,
      caseNumber: it.caseNumber,
      attempts: it.attempts,
      finishedAt: it.finishedAt,
    }))
    .sort((a, b) => (rank[a.state] ?? 9) - (rank[b.state] ?? 9));

  return NextResponse.json({ counts, rows });
}
