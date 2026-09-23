// «Sudya ma'lumotini kuchaytirilgan sinxron» — foydalanuvchi Hisobot sahifasidan bosadi.
// Fon'da (worker) har 20 daqiqada 5 firma × 40 = 200 ta ish detali olinadi. Bu tugma bosilsa
// bir yo'la firma boshiga 200 ta ish tortadi (5 firma × 200 = 1000) — ~5-6 soatda tugaydi.
//
// GAT (cabinet rate-limit): so'rovlar ichkarida 8 s pauza — burst-block xavfi yo'q.
// Guard: ADMIN yoki boss-report ruxsati. Concurrency: bitta job Setting flag orqali.
import { NextResponse } from 'next/server';
import { requireAccess } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getStoredCabinetSession } from '@/lib/cabinet/session';
import { SessionExpiredError } from '@/lib/session-store';
import { ingestCabinetDetails } from '@/lib/cabinet/detail-ingest';
import { FIRMS } from '@/lib/firms';

export const runtime = 'nodejs';
export const maxDuration = 60; // faqat qatorga qo'yish uchun — job fon'da davom etadi

const LOCK_KEY = 'court_detail_boost_running';
const STAMP_KEY = 'court_detail_refreshed_at';

async function readLock(): Promise<number | null> {
  const s = await prisma.setting.findUnique({ where: { key: LOCK_KEY }, select: { value: true } });
  if (!s?.value) return null;
  const t = Number(s.value);
  if (!Number.isFinite(t)) return null;
  // 30 daqiqadan eski qulf — ehtimol job halok bo'lgan, tashlab yuboramiz.
  if (Date.now() - t > 30 * 60_000) return null;
  return t;
}

async function setLock(v: number | null): Promise<void> {
  if (v == null) await prisma.setting.deleteMany({ where: { key: LOCK_KEY } });
  else await prisma.setting.upsert({ where: { key: LOCK_KEY }, create: { key: LOCK_KEY, value: String(v) }, update: { value: String(v) } });
}

export async function POST() {
  await requireAccess('boss-report');
  const existing = await readLock();
  if (existing != null) {
    const secAgo = Math.round((Date.now() - existing) / 1000);
    return NextResponse.json({ started: false, reason: 'already_running', startedSecondsAgo: secAgo });
  }
  await setLock(Date.now());
  // Fon vazifa — javob darhol qaytadi. Har firma bo'yicha 200 ta ish detali olinadi.
  // Har so'rov orasi 8s (ingestCabinetDetails ichida), shu boshdan-oyoq ~5-6 soat.
  const perFirm = 200;
  void (async () => {
    let totalFetched = 0;
    for (const f of FIRMS) {
      try {
        const s = await getStoredCabinetSession(f.stir);
        const r = await ingestCabinetDetails(s, f.branchCode, { limit: perFirm, onlyUnresolved: true });
        totalFetched += r.fetched;
        console.log(`[boost] ${f.branchCode}: ${r.fetched}/${r.total} olindi (PINFL:${r.withPinfl}, xato:${r.failed})`);
      } catch (e) {
        const msg = e instanceof SessionExpiredError ? 'sessiya yo\'q' : (e as Error).message?.slice(0, 200);
        console.error(`[boost] ${f.branchCode}: ${msg}`);
      }
    }
    if (totalFetched > 0) {
      await prisma.setting.upsert({
        where: { key: STAMP_KEY },
        create: { key: STAMP_KEY, value: new Date().toISOString() },
        update: { value: new Date().toISOString() },
      });
    }
    await setLock(null);
    console.log(`[boost] tugadi: jami ${totalFetched} ta ish detali olindi`);
  })().catch(async (e) => { console.error('[boost] fatal:', e); await setLock(null); });
  return NextResponse.json({ started: true, perFirm, firms: FIRMS.length, estimatedMinutes: Math.round(perFirm * FIRMS.length * 8 / 60) });
}

export async function GET() {
  await requireAccess('boss-report');
  const existing = await readLock();
  const stamp = await prisma.setting.findUnique({ where: { key: STAMP_KEY }, select: { value: true } });
  return NextResponse.json({
    running: existing != null,
    startedAt: existing ? new Date(existing).toISOString() : null,
    lastSyncAt: stamp?.value ?? null,
  });
}
