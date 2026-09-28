// «Sudyalarni topish» — Hisobot sahifasidagi sudya sinxroni boshqaruvi (start/stop/restart) va jonli
// holat. Sinxronni endi WORKER yuritadi (src/lib/cabinet/judge-sync.ts): bu route faqat so'rov qo'yadi
// va holatni o'qiydi. Ilgari sikl web jarayonida yurardi — deploy uni o'ldirardi, qulf 30 daqiqada
// «eskirib» ikkinchi nusxa ochilardi va firmaga atigi 200 ta ish olinardi (oxirigacha yetmasdi).
import { NextRequest, NextResponse } from 'next/server';
import { requireAccess } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  readJudgeState, judgeStateAlive, requestJudgeSync, judgePending,
  JUDGE_SYNC_REQUEST, JUDGE_SYNC_STOP,
} from '@/lib/cabinet/judge-sync';
import { DETAIL_FETCH_INTERVAL_MS } from '@/lib/cabinet/detail-ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET — jonli holat (panel ishlaganda ~8s, bo'sh turganda ~30s da so'raydi)
export async function GET() {
  await requireAccess('boss-report');
  const [st, req, pending, stamp] = await Promise.all([
    readJudgeState(),
    prisma.setting.findUnique({ where: { key: JUDGE_SYNC_REQUEST }, select: { value: true } }),
    judgePending(),
    prisma.setting.findUnique({ where: { key: 'court_detail_refreshed_at' }, select: { value: true } }),
  ]);
  const running = judgeStateAlive(st);
  let queued = false; let retryAt: string | null = null;
  if (req?.value) { queued = true; try { retryAt = JSON.parse(req.value).retryAt ?? null; } catch { /* */ } }
  const remaining = running ? Math.max(0, st.total - st.done) : pending.length;
  return NextResponse.json({
    running,
    queued,                       // so'rov qo'yilgan — worker ~15 s ichida oladi (yoki retryAt'da)
    retryAt,
    startedAt: st.startedAt,
    finishedAt: st.finishedAt,
    elapsedSec: running && st.startedAt ? Math.round((Date.now() - new Date(st.startedAt).getTime()) / 1000) : 0,
    progress: { total: st.total, done: st.done, found: st.found, failed: st.failed, firm: st.firm },
    remaining,                    // hali tekshirilishi kerak bo'lgan ishlar
    etaMinutes: Math.round((remaining * DETAIL_FETCH_INTERVAL_MS) / 60_000),
    scope: st.scope,              // 'mib' — hozir MIB hisoboti uchun alohida yurish (umumiy pauzada)
    stopped: st.stopped,
    note: st.note,
    lastSyncAt: stamp?.value ?? null,
  });
}

// POST { action?: 'start' | 'stop' | 'restart' }
export async function POST(req: NextRequest) {
  await requireAccess('boss-report');
  let action = 'start';
  try { const b = await req.json(); if (b?.action) action = String(b.action); } catch { /* bo'sh tana — start */ }

  if (action === 'stop') {
    await prisma.setting.upsert({ where: { key: JUDGE_SYNC_STOP }, create: { key: JUDGE_SYNC_STOP, value: '1' }, update: { value: '1' } });
    await prisma.setting.deleteMany({ where: { key: JUDGE_SYNC_REQUEST } });
    return NextResponse.json({ ok: true });
  }
  const st = await readJudgeState();
  if (action === 'start' && judgeStateAlive(st)) return NextResponse.json({ started: false, reason: 'already_running' });
  // restart — ishlayotgan bo'lsa ham navbatga qo'yamiz (joriy yurish tugagach darhol qayta boshlanadi).
  await requestJudgeSync(null);
  return NextResponse.json({ started: true });
}
