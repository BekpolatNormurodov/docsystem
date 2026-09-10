import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public webhook the operator's phone SMS-forwarder POSTs to. FORMATGA BEFARQ: JSON (istalgan
// maydon nomi, ichma-ich/massiv ham), urlencoded yoki oddiy matn — hammasidan 4-7 xonali OTP ajratadi.
// Avtomator SMS so'ragandan keyin MibSms'dan yangi, ishlatilmagan kodni oladi. Autentifikatsiyasiz
// (telefon cookie yubormaydi) — faqat raqamli kod yozadi, hech narsa o'qib chiqarilmaydi.

// Kalit so'zdan keyingi raqam — eng ishonchli (kod/kodi/kodingiz, code, пароль/код, tasdiqlash, otp).
function keywordCode(str: string): string | null {
  const m = str.match(/(?:код|kod|code|пароль|парол|tasdiqlash|passcode|otp)\D{0,15}(\d{4,7})/i);
  return m ? m[1]! : null;
}
// Kalit so'z bo'lmasa — eng uzun raqam ketma-ketligi (OTP odatda 5-6 xona; «2026» kabi yil emas).
function digitCode(str: string): string | null {
  for (const re of [/(?<!\d)\d{6}(?!\d)/, /(?<!\d)\d{5}(?!\d)/, /(?<!\d)\d{7}(?!\d)/, /(?<!\d)\d{4}(?!\d)/]) {
    const m = str.match(re); if (m) return m[0]!;
  }
  return null;
}

// JSON ichidagi BARCHA matn qiymatlarini (ichma-ich obyekt/massivdan) yig'ib olamiz.
function collectStrings(v: unknown, acc: string[] = [], depth = 0): string[] {
  if (depth > 6 || acc.length > 200) return acc;
  if (typeof v === 'string') { if (v) acc.push(v); }
  else if (typeof v === 'number') acc.push(String(v));
  else if (Array.isArray(v)) for (const x of v) collectStrings(x, acc, depth + 1);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) collectStrings(x, acc, depth + 1);
  return acc;
}

function extractFromCandidates(candidates: string[]): string | null {
  // 1-o'tish: kalit so'zli — ishonchli. 2-o'tish: istalgan raqam ketma-ketligi.
  for (const c of candidates) { const k = keywordCode(c); if (k) return k; }
  for (const c of candidates) { const d = digitCode(c); if (d) return d; }
  return null;
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const candidates: string[] = [];
  const trimmed = rawBody.trim();

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try { collectStrings(JSON.parse(rawBody), candidates); } catch { /* JSON emas — pastda */ }
  }
  if (candidates.length === 0 && rawBody.includes('=')) {
    try { for (const val of new URLSearchParams(rawBody).values()) if (val) candidates.push(val); } catch { /* ignore */ }
  }
  candidates.push(rawBody); // oxirgi chora: butun tana matni

  const code = extractFromCandidates(candidates);
  if (code) {
    const ua = req.headers.get('user-agent') || '';
    await prisma.mibSms.create({ data: { code, raw: rawBody.slice(0, 1000), source: ua.includes('Mozilla') ? 'web-test' : 'forwarder' } });
  }
  return NextResponse.json({ success: true, received: true, extractedCode: code });
}

// GET ?code=1234 — qo'lda test; oddiy GET — health.
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  if (code && /^\d{4,7}$/.test(code)) {
    await prisma.mibSms.create({ data: { code, raw: `code=${code}`, source: 'get-test' } });
    return NextResponse.json({ success: true, extractedCode: code });
  }
  return NextResponse.json({ status: 'ok', server: 'MIB SMS webhook' });
}
