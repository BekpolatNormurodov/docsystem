import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';

const numArg = (v: unknown): number | undefined => { const n = Number(v); return v != null && v !== '' && Number.isInteger(n) && n > 0 ? n : undefined; };
const MAX = 1000;

// GET ?snapshotId=&firmId=&type=ariza|oferta&q= — «Yaratilganlar»: qaysi mijozларга ariza/oferta
// yaratilgan (arizaAt / ofertaAt belgilangan), PINFL + F.I.O + firma + sud + sana bilan. Qidiruv (q):
// PINFL yoki ism. Eng ko'p MAX ta (eng yangisi birinchi); undan oshsa `truncated`.
export async function GET(req: NextRequest) {
  await requireUser();
  const sp = req.nextUrl.searchParams;
  const snapshotId = numArg(sp.get('snapshotId'));
  const firmId = numArg(sp.get('firmId'));
  const isOferta = sp.get('type') === 'oferta';
  const q = (sp.get('q') || '').trim();

  const where = {
    ...(snapshotId ? { snapshotId } : {}),
    ...(firmId ? { firmId } : {}),
    ...(isOferta ? { ofertaAt: { not: null } } : { arizaAt: { not: null } }),
    ...(q ? { OR: [{ pinfl: { contains: q } }, { clientName: { contains: q } }] } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.arizaCase.count({ where }),
    prisma.arizaCase.findMany({
      where,
      orderBy: isOferta ? [{ ofertaAt: 'desc' }, { id: 'desc' }] : [{ arizaAt: 'desc' }, { id: 'desc' }],
      take: MAX,
      select: {
        pinfl: true, clientName: true, kod: true, arizaAt: true, ofertaAt: true,
        firm: { select: { shortName: true } },
        court: { select: { shortName: true } },
      },
    }),
  ]);

  const items = rows.map((r) => ({
    pinfl: r.pinfl,
    clientName: r.clientName,
    firmName: r.firm?.shortName ?? r.kod ?? null,
    courtName: r.court?.shortName ?? null,
    at: (isOferta ? r.ofertaAt : r.arizaAt)?.toISOString() ?? null,
  }));

  return NextResponse.json({ total, items, truncated: total > items.length });
}
