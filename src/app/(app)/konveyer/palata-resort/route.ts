import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { resortFirmScanned } from '@/lib/palata-attach';
import { reapStaleOcrJobs } from '@/lib/palata-ocr';
import { audit, AuditAction } from '@/lib/audit';
import { getT } from '@/lib/i18n/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST { firm } — BITTA FIRMANI to'liq tozalab qayta sartirovka qilish.
//
// «Bazaga saqlash» (palata-attach) dan FARQI: u qo'shimcha (idempotent) saqlash — mavjud
// hujjatga tegmaydi yoki yangilaydi. Bu esa AVVAL o'sha firmaning imzolangan-skan
// hujjatlarini BUTUNLAY o'chiradi, so'ng skandan qaytadan bo'lib har mijozga biriktiradi.
// Sartirovka bir marta chalkash ketgan bo'lsa (ariza boshqa odamga tushgan) shu bilan
// tuzatiladi. Faqat SHU firma — boshqalariga tegilmaydi.
//
// Progress polling «Bazaga saqlash» bilan bir xil: GET /konveyer/palata-attach (bitta
// PALATA_ATTACH job turi ishlatiladi).
export async function POST(req: Request) {
  await requireUser();
  await reapStaleOcrJobs();
  const t = getT();

  const running = await prisma.job.findFirst({
    where: { type: { in: ['PALATA_OCR', 'PALATA_ATTACH'] }, status: { in: ['PENDING', 'RUNNING'] } },
  });
  if (running) return NextResponse.json({ error: t('Jarayon allaqachon ishlayapti, kuting.') }, { status: 409 });

  const body = await req.json().catch(() => ({} as { firm?: string }));
  const firm = String((body as { firm?: string })?.firm ?? '').trim();
  if (!firm) return NextResponse.json({ error: t('Firma tanlanmagan') }, { status: 400 });

  const job = await prisma.job.create({ data: { type: 'PALATA_ATTACH', status: 'PENDING', total: 0, progress: 0 } });
  void (async () => {
    await prisma.job.updateMany({ where: { id: job.id }, data: { status: 'RUNNING', message: `${firm}: ${t('tozalab qayta sartirovka…')}` } });
    try {
      let lastAt = 0;
      const r = await resortFirmScanned(firm, {
        onProgress: (d, tot) => {
          if (d - lastAt >= 10 || d === tot) { lastAt = d; prisma.job.updateMany({ where: { id: job.id }, data: { progress: d, total: Math.max(1, tot) } }).catch(() => {}); }
        },
      });
      const msg =
        `${r.firm}: ${r.updated + r.linked} ${t('qayta sartirovka qilindi')}` +
        (r.kept ? ` · ${r.kept} ${t('tegilmadi (skanda yo‘q)')}` : '') +
        (r.noCase ? ` · ${r.noCase} ${t('ish topilmadi')}` : '') +
        (r.noMatch ? ` · ${r.noMatch} ${t('firma aniqlanmadi')}` : '');
      await prisma.job.updateMany({ where: { id: job.id }, data: { status: 'DONE', progress: 1, total: 1, message: msg } });
      await audit(AuditAction.PALATA_SCAN, { target: `palata:resort:${r.firm}`, detail: r });
    } catch (e) {
      await prisma.job.updateMany({ where: { id: job.id }, data: { status: 'FAILED', message: e instanceof Error ? e.message : t('Xatolik') } }).catch(() => {});
    }
  })();
  return NextResponse.json({ jobId: job.id });
}
