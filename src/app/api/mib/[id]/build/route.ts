import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { parseHisobot } from '@/lib/mib/parse';
import { MANUAL_HOLAT } from '@/lib/mib/run';
import { getT } from '@/lib/i18n/server';

export const runtime = 'nodejs';
export const maxDuration = 120;

// POST { statusFilter? } — (re)build the client queue from the saved HISOBOT, keeping only rows whose
// «Holat» equals statusFilter (empty = all). Replaces any existing clients for this report.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  await requireAccess('mib-report');
  const t = getT();
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: t('id noto‘g‘ri') }, { status: 400 });
  const report = await prisma.mibReport.findUnique({ where: { id }, select: { sourcePath: true, autoRun: true } });
  if (!report) return NextResponse.json({ error: t('Hisobot topilmadi') }, { status: 404 });
  if (report.autoRun) return NextResponse.json({ error: t('Avtomator ishlayapti — avval to‘xtating') }, { status: 409 });

  const body = await req.json().catch(() => ({}));
  const statusFilter = (String(body?.statusFilter ?? '').trim() || null) as string | null;
  const dateFrom = (String(body?.dateFrom ?? '').trim() || null) as string | null; // YYYY-MM-DD
  const dateTo = (String(body?.dateTo ?? '').trim() || null) as string | null;

  // Qayta qurish tekshirilgan natijalarni O'CHIRADI (mijozlar qayta yaratiladi, ishlar cascade bilan
  // ketadi). 2026-09-30: run «pauza»dek ko'ringanda qayta qurildi — 35 mijozning 205 ish natijasi
  // yo'qoldi. Tekshirilgan mijoz bo'lsa — faqat aniq tasdiq (force) bilan.
  const checked = await prisma.mibClient.count({
    where: { reportId: id, checkedAt: { not: null }, OR: [{ holat: { not: MANUAL_HOLAT } }, { holat: null }] },
  });
  if (checked > 0 && body?.force !== true) {
    return NextResponse.json({
      error: t('Bu hisobotda tekshirilgan mijozlar bor — qayta qurish ularning natijasini o‘chiradi.'),
      needConfirm: true, checked,
    }, { status: 409 });
  }

  const parsed = await parseHisobot(report.sourcePath);
  // «Holat» filtri qo'llanmasi: bo'sh (null) → hammasi. Aks holda uch bosqichli mos kelish —
  // (1) exact, (2) normalize (kichik + probel/tinish/qavs tozalash), (3) substring. Excel qatorда
  // «Holati (MIB)» bo'sh (null) bo'lsa ham hisobga olamiz — user aytдi: «MIBда yoq bolsa ham bosaver».
  // Filter kirill/lotin farqi va qavsli qo'shimchalarga (masalan «MIBda (jarayonda)» ↔ «MIBда»)
  // bardosh qiladi.
  const normHolat = (s: string | null | undefined) => String(s || '').toLowerCase().replace(/[\s.`'()[\]{}\-_/\\,;:!?"«»""]/g, '');
  const wantExact = statusFilter || '';
  const wantNorm = normHolat(statusFilter);
  const matchHolat = (holat: string | null): boolean => {
    if (!statusFilter) return true;
    if (holat && holat === wantExact) return true;
    const h = normHolat(holat);
    if (!h && !wantNorm) return true;
    if (!h) return false;
    return h === wantNorm || h.includes(wantNorm) || wantNorm.includes(h);
  };
  const rows = parsed.rows.filter((r) => {
    if (!matchHolat(r.holat)) return false;
    if (dateFrom && (!r.sentDate || r.sentDate < dateFrom)) return false;
    if (dateTo && (!r.sentDate || r.sentDate > dateTo)) return false;
    return true;
  });

  // XAVFSIZLIK GUARD (2026-09-28): agar filter/parse natija 0 chiqargan bo'lsa VA reportда mavjud
  // (Excelдан qurilgan) clientlar bor bo'lsa — DELETE QILMAYMIZ. Aks holda «filter mos kelmadi» tufayli
  // 2400+ mijoz jimgina yo'qolib ketardi. Foydalanuvchiga aniq xato + o'chirilmagan clientlar soni.
  const existingExcel = await prisma.mibClient.count({ where: { reportId: id, OR: [{ holat: { not: MANUAL_HOLAT } }, { holat: null }] } });
  if (rows.length === 0 && existingExcel > 0) {
    return NextResponse.json({
      error: t('Filter tanlangan holat bilan mijoz topilmadi. Mavjud mijozlar o‘chirilmadi.'),
      matched: 0, existing: existingExcel, statusFilter,
    }, { status: 400 });
  }

  // Qo'lda qo'shilgan (bitta PINFL) mijozlarni SAQLAB qolamiz — faqat Excel'dan qurilganlarini
  // qayta quramiz. Excelda ham bor PINFL qo'lda qo'shilgan bo'lsa, dublikat bo'lmasin uchun chiqarib tashlaymiz.
  const manual = await prisma.mibClient.findMany({ where: { reportId: id, holat: MANUAL_HOLAT }, select: { pinfl: true } });
  const manualPinfls = new Set(manual.map((m) => m.pinfl));
  await prisma.mibClient.deleteMany({ where: { reportId: id, OR: [{ holat: { not: MANUAL_HOLAT } }, { holat: null }] } });
  const fresh = rows.filter((r) => !manualPinfls.has(r.pinfl));
  if (fresh.length) {
    await prisma.mibClient.createMany({
      data: fresh.map((r) => ({
        reportId: id, rowNo: r.rowNo, pinfl: r.pinfl, fio: r.fio, phone: r.phone, firm: r.firm,
        ishRaqami: r.ishRaqami, holat: r.holat, region: r.region, address: r.address, totalDebtSrc: r.totalDebtSrc,
      })),
    });
  }
  const total = await prisma.mibClient.count({ where: { reportId: id } });
  await prisma.mibReport.update({ where: { id }, data: { statusFilter, total } });
  return NextResponse.json({ total, statusFilter });
}
