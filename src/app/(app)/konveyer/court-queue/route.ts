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
  await requireStep('sud:send');
  const firmId = num(req.nextUrl.searchParams.get('firmId'));
  if (!firmId) return NextResponse.json({ error: 'firmId kerak' }, { status: 400 });

  // RAQAMLAR — BUTUN NAVBAT bo'yicha, ro'yxat esa cheklangan.
  //
  // Ilgari ikkalasi ham bitta `take: 300` so'rovdan chiqardi: 200 dan katta navbatda
  // sanoq JIM ravishda kesilardi va UI «195 navbatda» o'rniga «300» ko'rsatardi.
  // Sanoq — groupBy (arzon, to'liq), ro'yxat — alohida sahifa.
  const grouped = await prisma.courtQueueItem.groupBy({
    by: ['state'],
    where: { firmId },
    _count: { _all: true },
  });
  const counts = { PENDING: 0, RUNNING: 0, DONE: 0, FAILED: 0, SKIPPED: 0 } as Record<string, number>;
  for (const g of grouped) counts[g.state] = g._count._all;

  const items = await prisma.courtQueueItem.findMany({
    where: { firmId },
    orderBy: [{ updatedAt: 'desc' }],
    take: 300,
    select: {
      caseId: true, state: true, lastError: true, draftId: true, caseNumber: true, step: true,
      attempts: true, startedAt: true, finishedAt: true,
      case: { select: { clientName: true, pinfl: true } },
    },
  });

  // Xatolar tepada: operator birinchi navbatda shularni ko'rishi kerak.
  // SKIPPED xatolardan keyin darhol: u ham operator ARALASHUVINI talab qiladi (boji
  // to'lovi), shunchaki «tugagan» emas — DONE bilan bir joyda ko'milib ketmasligi kerak.
  const rank: Record<string, number> = { FAILED: 0, RUNNING: 1, SKIPPED: 2, PENDING: 3, DONE: 4 };
  const rows = items
    .map((it) => ({
      caseId: it.caseId,
      clientName: it.case?.clientName ?? null,
      pinfl: it.case?.pinfl ?? null,
      state: it.state,
      step: it.step,
      error: it.lastError,
      draftId: it.draftId,
      caseNumber: it.caseNumber,
      attempts: it.attempts,
      finishedAt: it.finishedAt,
    }))
    .sort((a, b) => (rank[a.state] ?? 9) - (rank[b.state] ?? 9));

  // Ro'yxat kesilgan bo'lsa — jim qolmaymiz. Operator «hammasi shu» deb o'ylamasin.
  const totalAll = Object.values(counts).reduce((a, b) => a + b, 0);
  return NextResponse.json({ counts, rows, shown: rows.length, totalAll, truncated: totalAll > rows.length });
}
