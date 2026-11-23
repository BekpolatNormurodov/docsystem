import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { getMibLogs } from '@/lib/mib/log-buffer';
import { getMibRunInfo, getMibHalt, isMibRunActive } from '@/lib/mib/run';
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
  const logs = getMibLogs(after, q, after ? 400 : 1500, report || undefined);
  if (!report) return NextResponse.json(logs);

  const since = new Date(Date.now() - 60 * 60_000);
  const [cfg, sms] = await Promise.all([
    getMibConfig(),
    prisma.mibSms.findMany({ where: { createdAt: { gte: since } }, select: { sim: true, consumed: true, code: true, raw: true, createdAt: true }, orderBy: { id: 'desc' }, take: 3000 }).catch(() => []),
  ]);
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
      halt: getMibHalt(report),
      sims: cfg.sims.map((x) => ({ id: x.id, label: x.label, phone: x.phone, state: x.state, slot: x.slot ?? null })),
      received: [...recv.values()],
    },
  });
}
