import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { buildMibExcel } from '@/lib/mib/excel';
import { attachJudgesToClients } from '@/lib/mib/judges';
import { getT } from '@/lib/i18n/server';

export const runtime = 'nodejs';
export const maxDuration = 120;

// GET — download as .xlsx. To'liq: Mijozlar + Ishlar + kesim varaqlari (Firma/Region/Hudud/Bank).
//   ?tab=firma|region|hudud|bank — faqat o'sha kesim varag'i (dashboard tabidan).
//   ?client=<id> — faqat bitta mijozning ishlari.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  await requireAccess('mib-report');
  const t = getT();
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: t('id noto‘g‘ri') }, { status: 400 });
  const report = await prisma.mibReport.findUnique({ where: { id } });
  if (!report) return NextResponse.json({ error: t('Hisobot topilmadi') }, { status: 404 });

  const tab = req.nextUrl.searchParams.get('tab') || undefined;
  const clientRaw = Number(req.nextUrl.searchParams.get('client'));
  const clientId = Number.isInteger(clientRaw) && clientRaw > 0 ? clientRaw : undefined;

  // Excel — faqat faol (archivedAt IS NULL) ishlar. Arxiv (qayta tekshirishда eski nusxa) chiqmasin.
  const own = await prisma.mibClient.findMany({
    where: { reportId: id, ...(clientId ? { id: clientId } : {}) },
    orderBy: { id: 'asc' }, include: { cases: { where: { archivedAt: null } } },
  });

  // OLDINGI NATIJA: shu hisobotda hali tekshirilmagan (navbatda / xato) mijozning PINFL'i boshqa hisobotda
  // allaqachon tekshirilgan bo'lsa — o'sha natija Excel'ga «oldingi tekshiruvdan» belgisi bilan qo'yiladi.
  // Aks holda katta ro'yxat qayta yuklanganda (2026-11-23: 6 136 dan 660 tasi tekshirilgan, 3 800+ PINFL
  // bo'yicha esa bazada tayyor natija bor edi) Excel deyarli bo'sh chiqardi. Yangi tekshiruv yetib kelgach
  // o'zi almashtiradi. Bitta mijoz eksportiga (client=) tegmaydi.
  let merged: (typeof own[number] & { prior?: { reportId: number; checkedAt: Date | null } })[] = own;
  if (!clientId) {
    const need = own.filter((c) => c.status !== 'DONE' && c.status !== 'CLEAN').map((c) => c.pinfl);
    const best = new Map<string, typeof own[number]>();
    for (let i = 0; i < need.length; i += 1000) {
      const rows = await prisma.mibClient.findMany({
        where: { pinfl: { in: need.slice(i, i + 1000) }, reportId: { not: id }, status: { in: ['DONE', 'CLEAN'] } },
        include: { cases: { where: { archivedAt: null } } },
      });
      for (const r of rows) {
        const ex = best.get(r.pinfl);
        // Eng YANGI tekshiruv ustun (eski hisobotdagi ko'proq ish emas — holat o'zgargan bo'lishi mumkin).
        if (!ex || (r.checkedAt?.getTime() ?? 0) > (ex.checkedAt?.getTime() ?? 0)) best.set(r.pinfl, r);
      }
    }
    merged = own.map((c) => {
      const p = c.status !== 'DONE' && c.status !== 'CLEAN' ? best.get(c.pinfl) : undefined;
      if (!p) return c;
      return { ...c, status: p.status, cases: p.cases, fio2: p.fio2 ?? c.fio2, totalDebt: p.totalDebt, currentDebt: p.currentDebt, checkedAt: p.checkedAt, error: null, prior: { reportId: p.reportId, checkedAt: p.checkedAt } };
    });
  }
  const clients = await attachJudgesToClients(merged);

  const buf = await buildMibExcel(report, clients, { tab, clientId });
  const tag = tab ? `_${tab}` : clientId ? `_mijoz${clientId}` : '';
  const name = `MIB_${(report.label || report.sourceFileName).replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40)}${tag}.xlsx`;
  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}"`,
      'Content-Length': String(buf.length),
    },
  });
}
