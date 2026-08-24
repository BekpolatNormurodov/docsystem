import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getMibConfig, setMibConfig, MIN_INTERVAL_SEC } from '@/lib/mib/config';

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
  return NextResponse.json({ ...cfg, webhookUrl: `${base}/api/mib-webhook`, minIntervalSec: MIN_INTERVAL_SEC });
}

// POST { phone?, baseUrl?, intervalSec? } — «nomer ulaydigan joy»: the phone the OTP is sent to.
//
// A phone number is NEVER applied by saving alone: it is parked in `phonePending` and only
// becomes the live `phone` once a real SMS arrives from that phone's forwarder (see
// confirmPendingPhone(), called from the test-sms poll). Otherwise a typo — or an idle edit
// left in the field — would silently break every OTP-gated MIB lookup. baseUrl/interval save
// normally; interval is floored at MIN_INTERVAL_SEC.
export async function POST(req: NextRequest) {
  await requireAdmin();
  const body = await req.json().catch(() => ({}));
  const patch: { phonePending?: string; baseUrl?: string; intervalSec?: number } = {};
  const current = await getMibConfig();

  let phoneQueued: string | null = null;
  if (typeof body?.phone === 'string') {
    const digits = body.phone.replace(/[^\d]/g, '');
    if (digits && digits !== current.phone) {
      patch.phonePending = digits;
      phoneQueued = digits;
    } else if (!digits || digits === current.phone) {
      patch.phonePending = ''; // o'zgarish yo'q (yoki bekor qilindi) — kutayotgani tozalanadi
    }
  }
  if (typeof body?.baseUrl === 'string' && body.baseUrl.trim()) patch.baseUrl = body.baseUrl.trim().replace(/\/+$/, '');
  if (body?.intervalSec !== undefined) {
    const n = Number(body.intervalSec);
    if (Number.isFinite(n)) patch.intervalSec = Math.max(MIN_INTERVAL_SEC, Math.round(n));
  }

  await setMibConfig(patch);
  const cfg = await getMibConfig();
  return NextResponse.json({ ...cfg, phoneQueued: !!phoneQueued, minIntervalSec: MIN_INTERVAL_SEC });
}
