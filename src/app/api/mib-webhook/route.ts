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
// ISO sana/vaqtni olib tashlaymiz — «2026-09-10T11:25:16» dagi «2026» kod deb olinmasin.
function stripDates(str: string): string {
  return str
    .replace(/\d{4}-\d{2}-\d{2}[T\s][\d:.]+\s*Z?/gi, ' ') // 2026-09-10T11:25:16.740Z
    .replace(/\d{4}-\d{2}-\d{2}/g, ' ')                    // 2026-09-10
    .replace(/\d{1,2}:\d{2}(:\d{2})?/g, ' ');              // 11:25:16
}
// Kalit so'z bo'lmasa — eng uzun raqam ketma-ketligi (OTP odatda 5-6 xona; «2026» kabi yil emas).
function digitCode(str: string): string | null {
  const s = stripDates(str);
  for (const re of [/(?<!\d)\d{6}(?!\d)/, /(?<!\d)\d{5}(?!\d)/, /(?<!\d)\d{7}(?!\d)/, /(?<!\d)\d{4}(?!\d)/]) {
    const m = s.match(re); if (m) return m[0]!;
  }
  return null;
}

// JSON ichidagi BARCHA matn qiymatlarini (ichma-ich obyekt/massivdan) yig'ib olamiz. Sana/vaqt/id kabi
// maydonlar TASHLAB ketiladi — ular OTP emas (masalan `timestamp`, `sentStamp`, `mrkdwn`).
const SKIP_KEY = /time|stamp|date|^ts$|^id$|mrkdwn|^from$|^sender$|^phone$|^number$/i;
function collectStrings(v: unknown, acc: string[] = [], depth = 0, key = ''): string[] {
  if (depth > 6 || acc.length > 200) return acc;
  if (key && SKIP_KEY.test(key)) return acc;
  if (typeof v === 'string') { if (v) acc.push(v); }
  else if (typeof v === 'number') acc.push(String(v));
  else if (Array.isArray(v)) for (const x of v) collectStrings(x, acc, depth + 1);
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) collectStrings(x, acc, depth + 1, k);
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
