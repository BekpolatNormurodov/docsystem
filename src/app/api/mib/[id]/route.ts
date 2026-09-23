import fs from 'node:fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { computeStats } from '@/lib/mib/stats';
import { parseHisobot } from '@/lib/mib/parse';
import { mibReportDir } from '@/lib/mib/store';
import { reconcileZombieClients, startMibRun, isMibRunActive } from '@/lib/mib/run';
import { getT } from '@/lib/i18n/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET — one report with its clients (+cases) and computed monitoring statistics.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  await requireAccess('mib-report');
  const t = getT();
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: t('id noto‘g‘ri') }, { status: 400 });
  const report = await prisma.mibReport.findUnique({ where: { id } });
  if (!report) return NextResponse.json({ error: t('Hisobot topilmadi') }, { status: 404 });
  // Jarayon restart bo'lsa qotib qolgan RUNNING mijozlarni tuzatamiz (holat noto'g'ri ko'rinmasin).
  await reconcileZombieClients(id).catch(() => {});
  // AUTO-RESUME (view orqali): deploy/restart INLINE avtomatorni o'ldiradi, lekin `autoRun` bayrog'i DB'да
  // qoladi. Hisobot ochilganda — jonli loop yo'q bo'lsa va PENDING mijoz bo'lsa — o'zi DAVOM etadi (qo'lда
  // «GO» bosish shart emas; ilgari kechasi soatlab bekor turishi mumkin edi). startMibRun idempotent:
  // ACTIVE bo'lsa yoki PENDING yo'q bo'lsa null qaytaradi, dublikat loop yaratmaydi.
  try {
    const rr = await prisma.mibReport.findUnique({ where: { id }, select: { autoRun: true } });
    if (rr?.autoRun && !isMibRunActive(id)) {
      const res = await startMibRun(id).catch(() => null);
      if (res) console.log(`[mib] resume-on-view: report ${id} → ${res.pending} PENDING davom ettirildi`);
    }
  } catch { /* resume ixtiyoriy — GET javobini to'smaydi */ }
  // Faol ishlar (archivedAt IS NULL) — arxivlangan (qayta tekshirishда eski nusxa) jadval/statistikaга kirmasin.
  // Arxivnи mijoz sahifasида «arxiv» toggle ochib ko'radi (ClientDetailFull).
  const clients = await prisma.mibClient.findMany({ where: { reportId: id }, orderBy: { id: 'asc' }, include: { cases: { where: { archivedAt: null } } } });
  const stats = computeStats(clients);
  // «Holat» + date-range filter options.
  let holatValues: { value: string; count: number }[] = [];
  let sentDateRange: { min: string | null; max: string | null } = { min: null, max: null };
  if (clients.length) {
    // Mijozlar allaqachon qurilgan — holat variantlarini ULARDAN olamiz. Faylni qayta parse
    // QILMAYMIZ: katta (masalan 5 MB, ko'p varaqli) HISOBOT har GET'da ~5s parse bo'lib, report
    // sahifasi «loading»da qotib qolardi (2026-09-16 auditi). Mijozlardan olish — bir zumda.
    const hc = new Map<string, number>();
    for (const c of clients) if (c.holat) hc.set(c.holat, (hc.get(c.holat) ?? 0) + 1);
    holatValues = [...hc.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
  } else if (!report.autoRun && report.sourcePath) {
    // Hali qurilmagan (yangi upload) — bir martalik parse bilan variantlarni ko'rsatamiz.
    const p = await parseHisobot(report.sourcePath).catch(() => null);
    if (p) { holatValues = p.holatValues; sentDateRange = p.sentDateRange; }
  }
  return NextResponse.json({ report, clients, stats, holatValues, sentDateRange });
}

// DELETE — remove a report (clients/cases cascade) + its folder.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  await requireAccess('mib-report');
  const t = getT();
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: t('id noto‘g‘ri') }, { status: 400 });
  const report = await prisma.mibReport.findUnique({ where: { id }, select: { autoRun: true } });
  if (!report) return NextResponse.json({ error: t('Hisobot topilmadi') }, { status: 404 });
  if (report.autoRun) return NextResponse.json({ error: t('Avtomator ishlayapti — avval to‘xtating') }, { status: 409 });
  await prisma.mibReport.delete({ where: { id } });
  await fs.rm(mibReportDir(id), { recursive: true, force: true }).catch(() => {});
  return NextResponse.json({ ok: true });
}
