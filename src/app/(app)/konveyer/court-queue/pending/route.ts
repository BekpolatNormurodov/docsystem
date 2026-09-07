import { NextResponse } from 'next/server';
import { requireStep } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';

// GET — FIRMA bo'yicha navbatda qolgan (PENDING/RUNNING) ishlar soni.
//
// NEGA KERAK: «Yuborish navbati» faqat brauzer xotirasida (React state) turardi — sahifa
// yangilansa yo'qolardi va operator navbat bekor bo'ldi deb o'ylardi. Aslida ma'lumot
// yo'qolmaydi: har bir ishning holati `CourtQueueItem` da saqlanadi. Shuning uchun navbatni
// ALOHIDA saqlash shart emas — u SHU jadvaldan kelib chiqadi. Sahifa yangilangach shu
// endpoint chaqiriladi va «davom ettirish» taklif qilinadi.
export async function GET() {
  await requireStep('sud:send');

  const grouped = await prisma.courtQueueItem.groupBy({
    by: ['firmId', 'state'],
    where: { state: { in: ['PENDING', 'RUNNING'] } },
    _count: { _all: true },
  });
  if (!grouped.length) return NextResponse.json({ firms: [] });

  const firms = await prisma.firm.findMany({
    where: { id: { in: [...new Set(grouped.map((g) => g.firmId))] } },
    select: { id: true, shortName: true, stir: true },
  });
  const byId = new Map(firms.map((f) => [f.id, f]));

  const acc = new Map<number, { firmId: number; firmName: string; stir: string | null; pending: number; running: number }>();
  for (const g of grouped) {
    const f = byId.get(g.firmId);
    const row = acc.get(g.firmId) ?? {
      firmId: g.firmId,
      firmName: f?.shortName ?? `Firma ${g.firmId}`,
      stir: f?.stir ?? null,
      pending: 0,
      running: 0,
    };
    if (g.state === 'RUNNING') row.running += g._count._all;
    else row.pending += g._count._all;
    acc.set(g.firmId, row);
  }

  // FAOL PARTIYALAR. Worker bir vaqtda BITTA job bajaradi, qolganlari PENDING bo'lib
  // navbatda turadi. Bu ma'lumotsiz operator «BRIGHT nega boshlanmayapti?» deb o'ylaydi —
  // holbuki u URBAN tugashini kutyapti. Shuning uchun har firmaga o'z partiyasining
  // holati va navbatdagi o'rni qo'shiladi.
  const jobs = await prisma.job.findMany({
    where: { type: 'COURT_SUBMIT', status: { in: ['PENDING', 'RUNNING'] } },
    select: { id: true, status: true, progress: true, total: true, params: true },
    orderBy: { id: 'asc' },
  });
  const jobByFirm = new Map<number, { jobId: number; status: string; progress: number; total: number; queuePos: number }>();
  let waitingPos = 0;
  for (const j of jobs) {
    const fid = Number((j.params as { firmId?: number } | null)?.firmId);
    if (!Number.isInteger(fid) || jobByFirm.has(fid)) continue;
    if (j.status === 'PENDING') waitingPos += 1;
    jobByFirm.set(fid, {
      jobId: j.id, status: j.status, progress: j.progress, total: j.total,
      queuePos: j.status === 'PENDING' ? waitingPos : 0,
    });
  }

  const rows = [...acc.values()].map((r) => ({ ...r, job: jobByFirm.get(r.firmId) ?? null }));
  // Faol partiyasi bor firmalar tepada — operator avval nima ketayotganini ko'rsin.
  rows.sort((a, b) => {
    const w = (x: typeof a) => (x.job?.status === 'RUNNING' ? 0 : x.job ? 1 : 2);
    return w(a) - w(b) || (b.pending + b.running) - (a.pending + a.running);
  });

  return NextResponse.json({ firms: rows });
}
