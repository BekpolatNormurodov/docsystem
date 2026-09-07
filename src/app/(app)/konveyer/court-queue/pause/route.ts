import { NextRequest, NextResponse } from 'next/server';
import { requireStep } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { isQueuePaused, setQueuePaused, pausedFirmIds } from '@/lib/cabinet/pacer';
import { audit, AuditAction } from '@/lib/audit';

export const runtime = 'nodejs';

// GET — jarayon pauzadami + BARCHA firmalar bo'yicha umumiy holat.
//
// Raqamlar shu yerdan beriladi (firma bo'yicha emas, umumiy): operator sahifa tepasida
// bir qarashda «hozir nima bo'lyapti» ni ko'rishi kerak — nechta ish navbatda turibdi,
// nechtasi ketdi, nechtasi xato bergan.
export async function GET() {
  await requireStep('sud:send');
  const [paused, pausedFirms, grouped, activeJobs] = await Promise.all([
    isQueuePaused(),
    pausedFirmIds(),
    prisma.courtQueueItem.groupBy({ by: ['state'], _count: { _all: true } }),
    // «Hozir HAQIQATAN ish ketyaptimi?» — buni faqat JOB bila oladi.
    //
    // Ilgari UI buni `counts.RUNNING > 0` dan chiqarardi. Lekin worker uzilganda navbat
    // yozuvi RUNNING bo'lib QOLIB KETADI (job o'ldi, yozuv qolgan) — va sahifa yashil
    // puls bilan «Yuborilmoqda» deb YOLG'ON ko'rsatib turardi, aslida hech nima
    // ketmayotgan bo'lsa ham (2026-09-07, deploy partiyani uzganda).
    prisma.job.count({ where: { type: 'COURT_SUBMIT', status: 'RUNNING' } }),
  ]);
  const counts: Record<string, number> = { PENDING: 0, RUNNING: 0, DONE: 0, FAILED: 0, SKIPPED: 0 };
  for (const g of grouped) counts[g.state] = g._count._all;
  // `pausedFirms` — alohida to'xtatilgan firmalar (umumiy pauzadan mustaqil).
  return NextResponse.json({ paused, pausedFirms, counts, running: activeJobs > 0 });
}

// POST { paused: boolean, firmId?: number } — sudga yuborishni to'xtatib turish / davom ettirish.
//
// `firmId` berilsa — FAQAT o'sha firma to'xtaydi, boshqalari ishlayveradi. Berilmasa — umumiy.
// Firma darajasi kerak bo'ldi (2026-09-07): BRIGHT'ning 200 talik partiyasi ketayotganda
// URBAN'ning 3 tasi ortida ~3 soat kutib qolardi.
//
// «Bekor» (Job.cancelRequested) dan farqi: u bitta partiyani tugatadi, pauza esa bazada
// saqlanadi (deploy/restart'dan keyin ham kuchda) va yangi partiya boshlanishini ham to'sadi.
// Pauzada ishlar PENDING bo'lib qoladi, davom ettirilganda aynan shu joydan ketadi.
export async function POST(req: NextRequest) {
  await requireStep('sud:send');
  const body = await req.json().catch(() => ({}));
  const paused = body?.paused === true;
  const rawFirm = Number(body?.firmId);
  const firmId = Number.isInteger(rawFirm) && rawFirm > 0 ? rawFirm : undefined;

  await setQueuePaused(paused, firmId);
  await audit(AuditAction.COURT_SUBMIT, {
    target: firmId ? `firm:${firmId}` : 'court-queue',
    detail: {
      amal: paused ? 'yuborish pauzaga olindi' : 'yuborish davom ettirildi',
      qamrov: firmId ? 'faqat shu firma' : 'barcha firmalar',
    },
  });
  return NextResponse.json({ paused, firmId: firmId ?? null });
}
