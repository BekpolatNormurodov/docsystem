import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getMibConfig, setMibConfig } from '@/lib/mib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET — current MIB config + the webhook URL to paste into the Android SMS forwarder (derived from the
// request origin so it works on localhost and in prod).
export async function GET(req: NextRequest) {
  await requireAdmin();
  const cfg = await getMibConfig();
  // Public webhook origin: explicit env → COOKIE_DOMAIN (prod: .yuristsystem.uz) → the real domain.
  // The Android forwarder must reach a PUBLIC URL, never the internal 0.0.0.0:5200 the app binds to.
  const base = process.env.MIB_PUBLIC_BASE?.replace(/\/+$/, '')
    || (process.env.COOKIE_DOMAIN ? `https://${process.env.COOKIE_DOMAIN.replace(/^\./, '')}` : '')
    || 'https://yuristsystem.uz';
  return NextResponse.json({ ...cfg, webhookUrl: `${base}/api/mib-webhook` });
}

// POST { phone?, baseUrl?, intervalSec? } — «nomer ulaydigan joy»: the phone the OTP is sent to.
export async function POST(req: NextRequest) {
  await requireAdmin();
  const body = await req.json().catch(() => ({}));
  const patch: { phone?: string; baseUrl?: string; intervalSec?: number } = {};
  if (typeof body?.phone === 'string') patch.phone = body.phone.replace(/[^\d]/g, '');
  if (typeof body?.baseUrl === 'string' && body.baseUrl.trim()) patch.baseUrl = body.baseUrl.trim().replace(/\/+$/, '');
  if (body?.intervalSec !== undefined) {
    const n = Number(body.intervalSec);
    if (Number.isFinite(n) && n >= 10) patch.intervalSec = Math.round(n);
  }
  await setMibConfig(patch);
  const cfg = await getMibConfig();
  return NextResponse.json({ ...cfg });
}
