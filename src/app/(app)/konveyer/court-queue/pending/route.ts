import { NextResponse } from 'next/server';
import { requireStep } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';

// GET — FIRMA bo'yicha navbat manzarasi: qolgani, ketgani, xatosi va o'tkazib
// yuborilgani (boji to'lanmagan).
//
// NEGA KERAK: «Yuborish navbati» faqat brauzer xotirasida (React state) turardi — sahifa
// yangilansa yo'qolardi va operator navbat bekor bo'ldi deb o'ylardi. Aslida ma'lumot
// yo'qolmaydi: har bir ishning holati `CourtQueueItem` da saqlanadi. Shuning uchun navbatni
// ALOHIDA saqlash shart emas — u SHU jadvaldan kelib chiqadi. Sahifa yangilangach shu
// endpoint chaqiriladi va «davom ettirish» taklif qilinadi.
export async function GET() {
  await requireStep('sud:send');

  // BARCHA holatlar olinadi, faqat PENDING/RUNNING emas.
  //
  // NEGA: panel «ketmoqda 0/195» deb job progressini ko'rsatar, firma qatori esa
  // navbat sanog'idan «5 ketdi, 195 navbatda» derdi — bir-biriga zid ikki raqam ekranda
  // 40 piksel masofada turardi (2026-09-07). Endi IKKALA joy ham AYNI shu sanoqdan
  // oziqlanadi: manba bitta bo'lsa, qarama-qarshilik ham bo'lmaydi.
  //
  // SKIPPED ham kerak: boji to'lanmagan ishlar hech qayerda ko'rinmasa, operator
  // «nega 195 emas, 117 ta ketdi?» degan savolga javob topa olmaydi.
  const grouped = await prisma.courtQueueItem.groupBy({
    by: ['firmId', 'state'],
    _count: { _all: true },
  });
  if (!grouped.length) return NextResponse.json({ firms: [] });

  const firms = await prisma.firm.findMany({
    where: { id: { in: [...new Set(grouped.map((g) => g.firmId))] } },
    select: { id: true, shortName: true, stir: true },
  });
  const byId = new Map(firms.map((f) => [f.id, f]));

  type Row = {
    firmId: number; firmName: string; stir: string | null;
    pending: number; running: number; done: number; failed: number; skipped: number;
  };
  const acc = new Map<number, Row>();
  for (const g of grouped) {
    const f = byId.get(g.firmId);
    const row: Row = acc.get(g.firmId) ?? {
      firmId: g.firmId,
      firmName: f?.shortName ?? `Firma ${g.firmId}`,
      stir: f?.stir ?? null,
      pending: 0, running: 0, done: 0, failed: 0, skipped: 0,
    };
    const n = g._count._all;
    if (g.state === 'RUNNING') row.running += n;
    else if (g.state === 'PENDING') row.pending += n;
    else if (g.state === 'DONE') row.done += n;
    else if (g.state === 'FAILED') row.failed += n;
    else if (g.state === 'SKIPPED') row.skipped += n;
    acc.set(g.firmId, row);
  }

  // FAOL PARTIYALAR. Worker bir vaqtda BITTA job bajaradi, qolganlari PENDING bo'lib
  // navbatda turadi. Bu ma'lumotsiz operator «BRIGHT nega boshlanmayapti?» deb o'ylaydi —
  // holbuki u URBAN tugashini kutyapti. Shuning uchun har firmaga o'z partiyasining
  // holati va navbatdagi o'rni qo'shiladi.
  const jobs = await prisma.job.findMany({
    where: { type: 'COURT_SUBMIT', status: { in: ['PENDING', 'RUNNING'] } },
    // `message` — dvigatel yozib turadigan JONLI holat («keyingisi 802s dan keyin»).
    // Busiz portal sovutish davrida ekran 15 daqiqa qimirlamay turadi va operator
    // «osilib qoldi» deb o'ylab, ketayotgan partiyani bekor qiladi (2026-09-07).
    select: { id: true, status: true, progress: true, total: true, params: true, message: true },
    orderBy: { id: 'asc' },
  });
  const jobByFirm = new Map<number, { jobId: number; status: string; progress: number; total: number; queuePos: number; message: string | null }>();
  let waitingPos = 0;
  for (const j of jobs) {
    const fid = Number((j.params as { firmId?: number } | null)?.firmId);
    if (!Number.isInteger(fid) || jobByFirm.has(fid)) continue;
    if (j.status === 'PENDING') waitingPos += 1;
    jobByFirm.set(fid, {
      jobId: j.id, status: j.status, progress: j.progress, total: j.total,
      queuePos: j.status === 'PENDING' ? waitingPos : 0,
      message: j.message ?? null,
    });
  }

  const rows = [...acc.values()]
    .map((r) => ({ ...r, job: jobByFirm.get(r.firmId) ?? null }))
    // Faqat OPERATOR ARALASHUVI kutilayotgan firmalar: davom ettirish kerak bo'lgan
    // navbat, xato bergan yoki boji to'lanmagan ishlar. Butunlay tugagan firma bu
    // paneldan chiqib ketadi — u yerda ko'rsatiladigan amal qolmaydi.
    .filter((r) => r.pending + r.running + r.failed + r.skipped > 0);
  // Faol partiyasi bor firmalar tepada — operator avval nima ketayotganini ko'rsin.
  rows.sort((a, b) => {
    const w = (x: typeof a) => (x.job?.status === 'RUNNING' ? 0 : x.job ? 1 : 2);
    return w(a) - w(b) || (b.pending + b.running) - (a.pending + a.running);
  });

  return NextResponse.json({ firms: rows });
}
