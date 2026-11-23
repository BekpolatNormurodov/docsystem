import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { getMibLogs, getMibLogsWithHistory } from '@/lib/mib/log-buffer';
import { getMibRunInfo, getMibHalt, isMibRunActive, getSavedSimStat } from '@/lib/mib/run';
import { getMibConfig, parseSimSlot } from '@/lib/mib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET ?after=<id>&q=<substring>&report=<id> — MIB avtomator loglarining jonli quyrug'i (in-process bufer).
//   q      — masalan mijoz PINFL'i (o'sha PINFL bo'yicha loglarni ajratish);
//   report — faqat o'sha hisobot run'i loglari + jonli monitor ma'lumoti (`monitor`): har SIM statistikasi
//            (so'raldi / keldi / kelmadi), parallel oyna, kutish holati va oxirgi 60 daqiqada kelgan SMS'lar
//            (SIM bo'yicha; belgisizlari forwarder slotidan).
export async function GET(req: NextRequest) {
  await requireAccess('mib-report');
  const sp = req.nextUrl.searchParams;
  const after = Number(sp.get('after')) || 0;
  const q = sp.get('q') || undefined;
  const report = Number(sp.get('report')) || 0;
  if (!report) return NextResponse.json(getMibLogs(after, q));
  // Birinchi o'qish (after=0) — diskdagi oldingi run'lar loglari ham (pauza/restartdan keyin bo'sh qolmasin).
  const logs = after ? getMibLogs(after, q, 400, report) : await getMibLogsWithHistory(report, 1500);

  const since = new Date(Date.now() - 60 * 60_000);
  const [cfg, sms, statusRows, recent, saved] = await Promise.all([
    getMibConfig(),
    prisma.mibSms.findMany({ where: { createdAt: { gte: since } }, select: { sim: true, consumed: true, code: true, raw: true, createdAt: true }, orderBy: { id: 'desc' }, take: 3000 }).catch(() => []),
    prisma.mibClient.groupBy({ by: ['status'], where: { reportId: report }, _count: { _all: true } }).catch(() => []),
    // Tezlik: oxirgi 15 daqiqada tekshirilgan mijozlar (pauza/restart ham hisobga kiradi — haqiqiy sur'at).
    prisma.mibClient.count({ where: { reportId: report, status: { in: ['DONE', 'CLEAN'] }, checkedAt: { gte: new Date(Date.now() - 15 * 60_000) } } }).catch(() => 0),
    getSavedSimStat(report),
  ]);
  const st: Record<string, number> = {};
  for (const r of statusRows) st[r.status] = r._count._all;
  const total = Object.values(st).reduce((a, b) => a + b, 0);
  const checked = (st.DONE ?? 0) + (st.CLEAN ?? 0);
  const pending = (st.PENDING ?? 0) + (st.RUNNING ?? 0);
  const perMin = Math.round((recent / 15) * 100) / 100;
  // SMS'lar SIM bo'yicha: belgili — o'z id'si; belgisiz — matndagi slot ("slot:2"); umuman aniqlanmagani — "?".
  const recv = new Map<string, { key: string; count: number; used: number; lastAt: string | null }>();
  for (const r of sms) {
    if (!r.code) continue; // kodsiz test xabarlar sanalmaydi
    const slot = r.sim ? null : parseSimSlot(r.raw);
    const key = r.sim ?? (slot ? `slot:${slot}` : '?');
    const v = recv.get(key) ?? { key, count: 0, used: 0, lastAt: null };
    v.count += 1; if (r.consumed) v.used += 1; if (!v.lastAt) v.lastAt = r.createdAt.toISOString();
    recv.set(key, v);
  }
  return NextResponse.json({
    ...logs,
    monitor: {
      active: isMibRunActive(report),
      run: getMibRunInfo(report),
      saved, // run ishlamayotganda ko'rsatiladigan jamlangan SIM statistikasi
      progress: { total, checked, pending, failed: st.FAILED ?? 0, perMin, etaMin: perMin > 0 ? Math.round(pending / perMin) : null },
      halt: getMibHalt(report),
      sims: cfg.sims.map((x) => ({ id: x.id, label: x.label, phone: x.phone, state: x.state, slot: x.slot ?? null })),
      received: [...recv.values()],
    },
  });
}
