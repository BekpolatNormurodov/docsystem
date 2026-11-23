import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { MibEngine } from '@/lib/mib/engine';
import { getMibConfig } from '@/lib/mib/config';
import { pushMibLog } from '@/lib/mib/log-buffer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface Check { key: 'site' | 'session' | 'form' | 'sms'; ok: boolean; warn?: boolean; ms?: number; detail: string }

// GET — «Ulanishni tekshirish»: avtomator bosadigan yo'lning o'zini (captcha/SMS'siz) bir marta bosib
// ko'radi: mib.uz ochiladimi → sessiya (JSESSIONID) beriladimi → «Qarzdorlikni tekshirish» formasi
// topiladimi → SMS raqami sozlanganmi. Hech narsa yozmaydi, mijoz tekshirmaydi — xavfsiz diagnostika.
// Ko'p mijoz ketma-ket «xato» bo'lganda sabab serverdami (tarmoq/blok) yoki sayt o'zgarganmi — shu ko'rsatadi.
export async function GET() {
  await requireAccess('mib-report');
  const cfg = await getMibConfig();
  const checks: Check[] = [];
  const engine = new MibEngine(cfg.baseUrl, { timeoutMs: 15_000 });

  let homeHtml = '';
  let t0 = Date.now();
  try {
    const s = await engine.initSession();
    homeHtml = s.homeHtml;
    const ms = Date.now() - t0;
    checks.push({ key: 'site', ok: true, warn: ms > 8000, ms, detail: ms > 8000 ? 'javob berdi, lekin juda sekin' : 'javob berdi' });
    checks.push(s.jsessionid
      ? { key: 'session', ok: true, detail: 'sessiya ochildi' }
      : { key: 'session', ok: false, detail: 'sessiya (JSESSIONID) berilmadi — sayt bloklagan yoki texnik ishlar' });
  } catch (e) {
    checks.push({ key: 'site', ok: false, ms: Date.now() - t0, detail: errText(e) });
  }

  if (checks[0]?.ok) {
    t0 = Date.now();
    try {
      const page = await engine.getDebtSearchPage(homeHtml);
      const found = /id="tab_pinfl"/i.test(page) && /Wicket\.Ajax/.test(page);
      checks.push(found
        ? { key: 'form', ok: true, ms: Date.now() - t0, detail: 'qidiruv formasi topildi' }
        : { key: 'form', ok: false, ms: Date.now() - t0, detail: 'PINFL qidiruv formasi topilmadi — sayt o‘zgargan yoki blok sahifasi qaytdi' });
    } catch (e) {
      checks.push({ key: 'form', ok: false, ms: Date.now() - t0, detail: errText(e) });
    }
  }

  // SMS zanjiri: raqam + oxirgi kelgan SMS (forwarder tirikligini taxminlash uchun).
  const lastSms = await prisma.mibSms.findFirst({ orderBy: { id: 'desc' }, select: { createdAt: true } }).catch(() => null);
  if (!cfg.deepDetail) checks.push({ key: 'sms', ok: true, detail: 'chuqur detal o‘chirilgan — SMS kerak emas' });
  else if (!cfg.phone) checks.push({ key: 'sms', ok: false, detail: 'SMS telefon raqami sozlanmagan' });
  else checks.push({ key: 'sms', ok: true, warn: !lastSms, detail: `raqam …${cfg.phone.slice(-4)}` });

  const ok = checks.every((c) => c.ok);
  pushMibLog(`ulanish tekshiruvi: ${checks.map((c) => `${c.key}=${c.ok ? 'OK' : 'XATO'}${c.ms != null ? ` ${c.ms}ms` : ''}`).join(', ')}`);
  return NextResponse.json({ ok, baseUrl: cfg.baseUrl, checks, lastSmsAt: lastSms?.createdAt ?? null, checkedAt: new Date().toISOString() });
}

function errText(e: unknown): string {
  const err = e as Error & { cause?: { code?: string; message?: string } };
  const cause = err?.cause?.code || err?.cause?.message;
  return [err?.message || String(e), cause].filter(Boolean).join(' — ');
}
