// «Sudya ma'lumotini kuchaytirilgan sinxron» — Hisobot sahifasidan boshqariladi (start/stop/restart)
// va jonli progress. Fon'da (worker) har 20 daqiqada avtomatik oz-ozdan oladi; bu tugma bir yo'la
// firma boshiga 200 ta ish detali tortadi (5 firma × 200 = 1000). cabinet rate-limit sabab so'rovlar
// ichkarida 8 s pauza bilan — ~5-6 soat. Firmalararo pauzada `stop` bayrog'i tekshiriladi.
import { NextRequest, NextResponse } from 'next/server';
import { requireAccess } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getStoredCabinetSession } from '@/lib/cabinet/session';
import { SessionExpiredError } from '@/lib/session-store';
import { ingestCabinetDetails } from '@/lib/cabinet/detail-ingest';
import { FIRMS } from '@/lib/firms';

export const runtime = 'nodejs';
export const maxDuration = 60;

const LOCK_KEY = 'court_detail_boost_running';   // ISO start vaqti (ishlab turgani belgisi)
const STOP_KEY = 'court_detail_boost_stop';      // '1' — keyingi firma oldidan to'xtaydi
const PROG_KEY = 'court_detail_boost_progress';  // JSON {firmsDone,firmsTotal,fetched,startedAt}
const STAMP_KEY = 'court_detail_refreshed_at';
const PER_FIRM = 200;
const STALE_MS = 30 * 60_000; // 30 daqiqadan eski qulf — halok bo'lgan job, e'tiborsiz

async function getSetting(key: string): Promise<string | null> {
  const s = await prisma.setting.findUnique({ where: { key }, select: { value: true } });
  return s?.value ?? null;
}
async function setSetting(key: string, value: string | null): Promise<void> {
  if (value == null) await prisma.setting.deleteMany({ where: { key } });
  else await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}
async function activeLockStart(): Promise<number | null> {
  const v = await getSetting(LOCK_KEY);
  if (!v) return null;
  const t = Number(v);
  if (!Number.isFinite(t) || Date.now() - t > STALE_MS) return null; // eskirgan → yo'q deb hisoblanadi
  return t;
}

// Fon'da yuritiladigan boost — bir firma tugagach progress yoziladi, keyingisidan oldin stop tekshiriladi.
function runBoost(startedAt: number): void {
  void (async () => {
    let fetched = 0;
    let firmsDone = 0;
    for (const f of FIRMS) {
      if ((await getSetting(STOP_KEY)) === '1') break; // foydalanuvchi to'xtatdi
      try {
        const s = await getStoredCabinetSession(f.stir);
        const r = await ingestCabinetDetails(s, f.branchCode, { limit: PER_FIRM, onlyUnresolved: true });
        fetched += r.fetched;
        console.log(`[boost] ${f.branchCode}: ${r.fetched}/${r.total} (PINFL:${r.withPinfl}, xato:${r.failed})`);
      } catch (e) {
        const msg = e instanceof SessionExpiredError ? 'sessiya yo\'q' : (e as Error).message?.slice(0, 200);
        console.error(`[boost] ${f.branchCode}: ${msg}`);
      }
      firmsDone++;
      await setSetting(PROG_KEY, JSON.stringify({ firmsDone, firmsTotal: FIRMS.length, fetched, startedAt }));
    }
    if (fetched > 0) await setSetting(STAMP_KEY, new Date().toISOString());
    await setSetting(LOCK_KEY, null);
    await setSetting(STOP_KEY, null);
    console.log(`[boost] tugadi: ${fetched} ta ish detali, ${firmsDone}/${FIRMS.length} firma`);
  })().catch(async (e) => { console.error('[boost] fatal:', e); await setSetting(LOCK_KEY, null); await setSetting(STOP_KEY, null); });
}

// GET — jonli holat (panel har ~8s so'raydi)
export async function GET() {
  await requireAccess('boss-report');
  const start = await activeLockStart();
  const [progRaw, stamp] = await Promise.all([getSetting(PROG_KEY), getSetting(STAMP_KEY)]);
  let progress: unknown = null;
  try { progress = progRaw ? JSON.parse(progRaw) : null; } catch { progress = null; }
  return NextResponse.json({
    running: start != null,
    startedAt: start ? new Date(start).toISOString() : null,
    elapsedSec: start ? Math.round((Date.now() - start) / 1000) : 0,
    progress,
    lastSyncAt: stamp ?? null,
    perFirm: PER_FIRM,
    firms: FIRMS.length,
    estimatedMinutes: Math.round(PER_FIRM * FIRMS.length * 8 / 60),
  });
}

// POST { action?: 'start' | 'stop' | 'restart' }
export async function POST(req: NextRequest) {
  await requireAccess('boss-report');
  let action = 'start';
  try { const b = await req.json(); if (b?.action) action = String(b.action); } catch { /* bo'sh tana — start */ }

  if (action === 'stop') {
    const start = await activeLockStart();
    if (start == null) return NextResponse.json({ ok: true, wasRunning: false });
    await setSetting(STOP_KEY, '1'); // loop keyingi firma oldidan to'xtaydi
    return NextResponse.json({ ok: true, wasRunning: true, note: 'keyingi_firma_oldidan_toxtaydi' });
  }

  const start = await activeLockStart();
  if (action === 'start' && start != null) {
    return NextResponse.json({ started: false, reason: 'already_running', startedSecondsAgo: Math.round((Date.now() - start) / 1000) });
  }
  // restart — eskirgan yoki turib qolgan qulfni majburan tozalab, yangidan boshlaymiz.
  if (action === 'restart') { await setSetting(LOCK_KEY, null); await setSetting(STOP_KEY, null); }

  const now = Date.now();
  await setSetting(LOCK_KEY, String(now));
  await setSetting(STOP_KEY, null);
  await setSetting(PROG_KEY, JSON.stringify({ firmsDone: 0, firmsTotal: FIRMS.length, fetched: 0, startedAt: now }));
  runBoost(now);
  return NextResponse.json({ started: true, perFirm: PER_FIRM, firms: FIRMS.length, estimatedMinutes: Math.round(PER_FIRM * FIRMS.length * 8 / 60) });
}
