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
  const m1 = str.match(/Kod\s*[:\s-]?\s*(\d{4,6})/i); if (m1) return m1[1]!;
  const m2 = str.match(/code\s*[:\s-]?\s*(\d{4,6})/i); if (m2) return m2[1]!;
  const m3 = str.match(/пароль\s*[:\s-]?\s*(\d{4,6})/i); if (m3) return m3[1]!;
  const m4 = str.match(/\b\d{4,6}\b/); if (m4) return m4[0]!;
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
