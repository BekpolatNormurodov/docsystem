import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { canAccess, type AccessKey } from '@/lib/access';

export const runtime = 'nodejs';

// Job turi → shu ZIPni yasagan sahifa(lar)ning ruxsat kaliti. Bo'sh ro'yxat = faqat ADMIN
// (bu route orqali yuklanmaydigan turlar: IMPORT, MIB_RUN, PALATA_*, TALABNOMA_FORM — oxirgisining
// o'z download route'i bor).
const JOB_ACCESS: Record<string, AccessKey[]> = {
  // To'liq paket ZIP: /ariza «Tayyorlash» (arizaOnly) va /sud «ZIP chiqarish» ikkalasi ham PACKET yasaydi.
  PACKET: ['ariza:prepare', 'sud:send'],
  COURT_SUBMIT: ['sud:send'],
  OFERTA: ['sud:oferta'],
  TALABNOMA: ['talabnoma'],
  // Hujjatlar bo'limidagi snapshot eksporti — yaratish allaqachon requireAdmin; yuklashni
  // hujjatlarni boshqaruvchi yuristga ham qoldiramiz (u shu ro'yxat bilan ishlaydi).
  EXPORT: ['docs-manage'],
};

// requireUser (not requireAdmin): a yurist who was granted a bulk step (e.g. «sud:oferta») generates
// the ZIP via the requireUser prepare-* routes, so they must also be allowed to download the result —
// otherwise the «yuklab olish» link 403s for the yurist and the feature is unusable for them.
// Ammo YOLG'IZ requireUser kam edi: 2026-09-08 tekshiruvida ma'lum bo'ldiki, istalgan login egasi
// /api/export/1/download … /api/export/300/download deb jobId'ni birma-bir aylantirib, HAR firmaning
// to'liq mijoz dossiyesini (F.I.O, PINFL, shartnoma, qarz) yuklab olardi — hatto faqat «invoice-check»
// yoki «mib» berilgan yurist ham (/jurnal barchaga job ro'yxatini ko'rsatadi). Shuning uchun yuklash
// endi job TURIGA mos grantni talab qiladi.
// Eslatma: foydalanuvchi↔firma darajasida cheklov qo'yilmadi — bunday model tizimda yo'q
// (CourtFirmAccess firma↔sud marshruti, foydalanuvchi ruxsati emas), ruxsat faqat bosqich kaliti
// bilan beriladi.
export async function GET(_req: NextRequest, { params }: { params: { jobId: string } }) {
  const user = await requireUser();

  const id = Number(params.jobId);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'topilmadi' }, { status: 404 });
  const job = await prisma.job.findUnique({ where: { id } });
  if (!job || job.status !== 'DONE' || !job.resultPath) {
    return NextResponse.json({ error: 'topilmadi' }, { status: 404 });
  }

  // 404 emas, 403 va aniq sabab: operator «yo'q ekan» deb o'ylab qidirib yurmasin — admindan
  // shu bosqich grantini so'rashi kerakligini bilsin.
  const needed = JOB_ACCESS[job.type] ?? [];
  if (user.role !== 'ADMIN' && !needed.some((k) => canAccess(user, k))) {
    return NextResponse.json({ error: 'Bu ZIPni yuklashga ruxsat yoʻq — kerakli bosqich berilmagan' }, { status: 403 });
  }

  const zipPath = path.join(process.cwd(), job.resultPath);
  if (!fs.existsSync(zipPath)) {
    return NextResponse.json({ error: 'topilmadi' }, { status: 404 });
  }

  const snapshot = job.snapshotId ? await prisma.snapshot.findUnique({ where: { id: job.snapshotId } }) : null;
  const dateStr = snapshot ? snapshot.reportDate.toISOString().slice(0, 10) : String(job.id);

  // Fayl nomida FIRMA va JOB raqami: 2026-09-08 gacha har ZIP «arizalar-<sana>.zip» nomi bilan tushardi,
  // shuning uchun bir kunda olingan BRIGHT va URBAN paketlari Downloads'da «arizalar-2026-09-08.zip» va
  // «arizalar-2026-09-08 (1).zip» bo'lib qolib, qaysi biri qaysi firma ekanini ochmasdan bilib bo'lmasdi.
  const jobParams = (job.params ?? {}) as Record<string, unknown>;
  const firmId = Number(jobParams.firmId);
  const firm = Number.isInteger(firmId) && firmId > 0
    ? await prisma.firm.findUnique({ where: { id: firmId }, select: { shortName: true } })
    : null;
  // «Hamma firma» qamrovida (firmId yo'q) firma bo'lagi tushib qoladi — yolg'on nom yozmaymiz.
  const firmPart = firm ? `${firm.shortName.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 24)}-` : '';
  const fileName = `arizalar-${firmPart}${dateStr}-job${job.id}.zip`;
  // ASCII zaxira: eski brauzerlar `filename*` ni tushunmaydi.
  const asciiName = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');

  const stat = fs.statSync(zipPath);
  const stream = fs.createReadStream(zipPath);
  return new NextResponse(stream as unknown as ReadableStream, {
    headers: {
      'Content-Type': 'application/zip',
      // Ikki shakl: ASCII zaxira nomi + RFC 5987 `filename*` (UTF-8). Nomni butunlay
      // percent-encode qilib qo'shtirnoq ichiga qo'yish noto'g'ri: brauzer uni ochmaydi va
      // fayl «arizalar-BRIGHT%20FUTURE-...» bo'lib tushardi (firma nomida lotin bo'lmagan
      // harf bo'lsa esa umuman o'qib bo'lmas nom chiqardi).
      'Content-Disposition':
        `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Content-Length': String(stat.size),
    },
  });
}
