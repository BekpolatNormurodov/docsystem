import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { getMibConfig, setMibConfig, addSim, updateSim, removeSim, MIN_INTERVAL_SEC, MAX_SIMS } from '@/lib/mib/config';
import { getT } from '@/lib/i18n/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Config + har SIMning webhook manzili va SMS statistikasi (oxirgi SMS, soni) — Sozlamalar oynasi uchun.
async function payload() {
  const cfg = await getMibConfig();
  // Public webhook origin: explicit env → COOKIE_DOMAIN (prod: .yuristsystem.uz) → the real domain.
  // The Android forwarder must reach a PUBLIC URL, never the internal 0.0.0.0:5200 the app binds to.
  const base = process.env.MIB_PUBLIC_BASE?.replace(/\/+$/, '')
    || (process.env.COOKIE_DOMAIN ? `https://${process.env.COOKIE_DOMAIN.replace(/^\./, '')}` : '')
    || 'https://yuristsystem.uz';
  const webhookUrl = `${base}/api/mib-webhook`;
  const stats = await prisma.mibSms.groupBy({ by: ['sim'], _count: { _all: true }, _max: { createdAt: true } }).catch(() => []);
  const bySim = new Map(stats.map((r) => [r.sim, r]));
  const sims = cfg.sims.map((x) => ({
    ...x,
    webhookUrl: `${webhookUrl}?sim=${x.id}`,
    smsCount: bySim.get(x.id)?._count._all ?? 0,
    lastSmsAt: bySim.get(x.id)?._max.createdAt ?? null,
  }));
  // Belgisiz (eski `?sim=`siz manzilga kelgan) SMS — forwarder hali umumiy manzilda ekanini ko'rsatadi.
  const untagged = { smsCount: bySim.get(null)?._count._all ?? 0, lastSmsAt: bySim.get(null)?._max.createdAt ?? null };
  return { ...cfg, sims, untagged, webhookUrl, minIntervalSec: MIN_INTERVAL_SEC, maxSims: MAX_SIMS };
}

// GET — current MIB config + the webhook URLs to paste into the Android SMS forwarders.
export async function GET() {
  await requireAccess('mib-report');
  return NextResponse.json(await payload());
}

// POST — sozlamalarni o'zgartirish. Bitta so'rovda bitta amal:
//   { addSim: { phone, label? } }            — yangi SIM ('pending': SMS so'ralmaydi)
//   { updateSim: { id, state?, label? } }    — yoqish/o'chirish ('on' | 'off') yoki nomini o'zgartirish
//   { removeSim: id }                         — SIMni o'chirish
//   { baseUrl?, intervalSec?, deepDetail? }  — umumiy sozlamalar
//
// Yangi raqam saqlash bilan O'ZI ishga tushmaydi: 'pending' bo'lib turadi va faqat o'sha SIMdan SMS
// kelgach (test-sms) yoki operator qo'lda yoqqach 'on' bo'ladi. Aks holda xato terilgan raqam unga
// so'ralgan har OTPni jimgina yo'qotardi.
export async function POST(req: NextRequest) {
  await requireAccess('mib-report');
  const t = getT();
  const body = await req.json().catch(() => ({}));

  if (body?.addSim) {
    const res = await addSim(String(body.addSim.phone ?? ''), typeof body.addSim.label === 'string' ? body.addSim.label : undefined);
    if (!res.ok) return NextResponse.json({ error: t(res.error) }, { status: 400 });
    return NextResponse.json(await payload());
  }
  if (body?.updateSim?.id) {
    const state = body.updateSim.state === 'on' || body.updateSim.state === 'off' ? body.updateSim.state : undefined;
    const ok = await updateSim(String(body.updateSim.id), { state, label: typeof body.updateSim.label === 'string' ? body.updateSim.label : undefined });
    if (!ok) return NextResponse.json({ error: t('SIM topilmadi') }, { status: 404 });
    return NextResponse.json(await payload());
  }
  if (body?.removeSim) {
    const ok = await removeSim(String(body.removeSim));
    if (!ok) return NextResponse.json({ error: t('SIM topilmadi') }, { status: 404 });
    return NextResponse.json(await payload());
  }

  const patch: { baseUrl?: string; intervalSec?: number; deepDetail?: boolean; twoPhase?: boolean } = {};
  if (typeof body?.deepDetail === 'boolean') patch.deepDetail = body.deepDetail;
  if (typeof body?.twoPhase === 'boolean') patch.twoPhase = body.twoPhase;
  if (typeof body?.baseUrl === 'string' && body.baseUrl.trim()) patch.baseUrl = body.baseUrl.trim().replace(/\/+$/, '');
  if (body?.intervalSec !== undefined) {
    const n = Number(body.intervalSec);
    if (Number.isFinite(n)) patch.intervalSec = Math.max(MIN_INTERVAL_SEC, Math.round(n));
  }
  await setMibConfig(patch);
  return NextResponse.json(await payload());
}
