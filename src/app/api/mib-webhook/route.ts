import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public webhook the operator's Android SMS-forwarder POSTs to. Accepts JSON / urlencoded / plain text
// in many shapes, extracts the 4–6 digit OTP, and stores it. The automator polls MibSms for a fresh,
// unconsumed code after it triggered an SMS. NOTE: intentionally unauthenticated (the phone can't send
// an auth cookie); it only ever writes a numeric code — no data is read out through it.
function extractCode(text: string | null | undefined): string | null {
  if (!text) return null;
  const str = String(text);
  // 1) Kalit so'zdan keyingi raqam — eng ishonchli (kod/kodi/kodingiz, code, пароль/код, tasdiqlash…).
  //    \D{0,15}: kalit so'z bilan raqam orasida 15 tagacha raqamsiz belgi bo'lishi mumkin
  //    («kodingiz: 483920», «Тасдиклаш коди 483920»).
  const kw = str.match(/(?:код|kod|code|пароль|парол|tasdiqlash|passcode|otp)\D{0,15}(\d{4,7})/i);
  if (kw) return kw[1]!;
  // 2) Kalit so'z topilmasa — eng uzun raqam ketma-ketligini afzal ko'ramiz. OTP odatda 5-6 xonali,
  //    shuning uchun «2026» kabi yil (4 xona) uzunroq kod bor bo'lsa tanlanmaydi (6→5→7→4).
  for (const re of [/(?<!\d)\d{6}(?!\d)/, /(?<!\d)\d{5}(?!\d)/, /(?<!\d)\d{7}(?!\d)/, /(?<!\d)\d{4}(?!\d)/]) {
    const m = str.match(re); if (m) return m[0]!;
  }
  return null;
}

async function ingest(smsText: string, rawBody: string, source: string): Promise<string | null> {
  const code = extractCode(smsText) || extractCode(rawBody);
  if (code) {
    await prisma.mibSms.create({ data: { code, raw: rawBody.slice(0, 1000), source } });
  }
  return code;
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  let smsText = rawBody;
  try {
    const j = JSON.parse(rawBody);
    smsText = j.content || j.msg || j.message || j.text || j.body || j.sms || j.payload || j.data || rawBody;
  } catch {
    if (rawBody.includes('=')) {
      try {
        const p = new URLSearchParams(rawBody);
        smsText = p.get('content') || p.get('msg') || p.get('message') || p.get('text') || p.get('body') || rawBody;
      } catch { /* keep rawBody */ }
    }
  }
  const ua = req.headers.get('user-agent') || '';
  const code = await ingest(String(smsText), rawBody, ua.includes('Mozilla') ? 'web-test' : 'forwarder');
  return NextResponse.json({ success: true, received: true, extractedCode: code });
}

// GET ?code=1234 — manual test injection; plain GET returns health.
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  if (code) {
    const saved = await ingest(`Test code: ${code}`, `code=${code}`, 'get-test');
    return NextResponse.json({ success: true, extractedCode: saved });
  }
  return NextResponse.json({ status: 'ok', server: 'MIB SMS webhook' });
}
