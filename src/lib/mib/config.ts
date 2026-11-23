// MIB module settings, stored in the shared Setting key/value table (like the davlat-boji setting).
// «nomer ulaydigan joy» = the phone number the OTP is sent to (set in admin); the mobile forwards the
// SMS to /api/mib-webhook.
import { prisma } from '@/lib/db';

const K = {
  phone: 'mib.phone',
  phonePending: 'mib.phonePending',
  phoneConfirmedAt: 'mib.phoneConfirmedAt',
  baseUrl: 'mib.baseUrl',
  intervalSec: 'mib.intervalSec',
  deepDetail: 'mib.deepDetail',
  smsTimeoutSec: 'mib.smsTimeoutSec',
  sims: 'mib.sims',
} as const;

/**
 * Bitta SIM (SMS qabul qiluvchi raqam). Bir nechta SIM ulansa avtomator SMS so'rovlarini ular orasida
 * taqsimlaydi — har raqam o'z OTP oqimini olib, tortish N barobar tezlashadi.
 *   state: 'pending' — kiritilgan, lekin hali SMS bilan tasdiqlanmagan (SMS SO'RALMAYDI);
 *          'on'      — ishlayapti; 'off' — operator vaqtincha o'chirgan.
 * `id` — qisqa barqaror kalit: shu SIM forwarder'i `…/api/mib-webhook?sim=<id>` ga POST qiladi, shunda
 * kelgan kod QAYSI raqamga tegishli ekani aniq bo'ladi (kodlar aralashmaydi).
 */
export interface MibSim {
  id: string; phone: string; label: string; state: 'pending' | 'on' | 'off'; addedAt: string;
  /** Telefondagi SIM SLOT raqami — forwarder SMS matnida «…на номер SIM 2» deb yuboradi. Bitta telefonda
   *  2 SIM bo'lsa forwarder bitta (umumiy) manzilga yuboradi; slot orqali kod qaysi SIMga kelgani aniqlanadi.
   *  Avtomator to'g'ri kod qaysi SIMga so'ralganini ko'rib slotni O'ZI o'rganadi (learnSimSlot). */
  slot?: number;
}
export const MAX_SIMS = 6;

export interface MibConfig {
  /** Birinchi ISHLAYOTGAN raqam (eski kod uchun qulaylik: «raqam sozlanganmi»). `sims`dan hosil bo'ladi. */
  phone: string;
  /** Barcha SIMlar (ishlayotgan + tasdiqlanmagan + o'chirilgan). */
  sims: MibSim[];
  baseUrl: string;
  intervalSec: number;
  /** Chuqur detal (SMS-OTP bilan har ish bo'yicha bank/sud/summa). O'chirilsa — faqat ijro ishi
   *  ro'yxati olinadi (SMS so'ralmaydi, tez va «birdan»). */
  deepDetail: boolean;
  /** SMS OTP kutish chegarasi (soniya). Sozlamalarда o'zgartiriladi — deploy shart emas. */
  smsTimeoutSec: number;
}

// Interval — mijozlar orasidagi pauza. Ilgari 60s edi (juda ehtiyotkor) → 2716 mijoz uchun ~45 soat
// faqat kutishда ketardi. Endi 30s (operator qarori) — 2 barobar tez, lekin oraliq saqlanadi.
// Chegara 2s gacha tushirildi — operator Sozlamalarда xohlagancha o'zgartiradi.
export const MIN_INTERVAL_SEC = 2;
const DEFAULTS: MibConfig = { phone: '', sims: [], baseUrl: 'https://mib.uz', intervalSec: 30, deepDetail: true, smsTimeoutSec: 120 };
export const MIN_SMS_TIMEOUT_SEC = 20;

const digitsOnly = (s: unknown) => String(s ?? '').replace(/\D/g, '');

/** Saqlangan `mib.sims` JSON'ini o'qiydi; yo'q bo'lsa ESKI yagona-raqam sozlamasidan (mib.phone /
 *  mib.phonePending) hosil qiladi — eski o'rnatma hech narsa qilmasdan ishlashda davom etadi. */
function readSims(map: Map<string, string>): MibSim[] {
  const raw = map.get(K.sims);
  if (raw) {
    try {
      const arr = JSON.parse(raw) as Partial<MibSim>[];
      if (Array.isArray(arr)) {
        return arr
          .filter((x) => x && typeof x.id === 'string' && digitsOnly(x.phone))
          .map((x, i) => ({
            id: x.id!, phone: digitsOnly(x.phone), label: String(x.label || `SIM ${i + 1}`),
            state: x.state === 'on' || x.state === 'off' ? x.state : 'pending', addedAt: String(x.addedAt || ''),
            ...(Number.isInteger(x.slot) && x.slot! >= 1 && x.slot! <= 9 ? { slot: x.slot } : {}),
          }));
      }
    } catch { /* buzuq JSON — eski kalitlarga tushamiz */ }
  }
  const legacy: MibSim[] = [];
  const live = digitsOnly(map.get(K.phone));
  const pend = digitsOnly(map.get(K.phonePending));
  if (live) legacy.push({ id: 's1', phone: live, label: 'SIM 1', state: 'on', addedAt: map.get(K.phoneConfirmedAt) || '' });
  if (pend && pend !== live) legacy.push({ id: live ? 's2' : 's1', phone: pend, label: live ? 'SIM 2' : 'SIM 1', state: 'pending', addedAt: '' });
  return legacy;
}

export async function getMibConfig(): Promise<MibConfig> {
  const rows = await prisma.setting.findMany({ where: { key: { in: Object.values(K) } } });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const intervalSec = Number(map.get(K.intervalSec));
  const sims = readSims(map);
  return {
    phone: sims.find((x) => x.state === 'on')?.phone || DEFAULTS.phone,
    sims,
    baseUrl: map.get(K.baseUrl) || DEFAULTS.baseUrl,
    intervalSec: Number.isFinite(intervalSec) && intervalSec >= MIN_INTERVAL_SEC ? intervalSec : DEFAULTS.intervalSec,
    deepDetail: map.get(K.deepDetail) !== '0', // default yoqilgan; faqat '0' o'chiradi
    smsTimeoutSec: (() => { const v = Number(map.get(K.smsTimeoutSec)); return Number.isFinite(v) && v >= MIN_SMS_TIMEOUT_SEC ? v : DEFAULTS.smsTimeoutSec; })(),
  };
}

export async function setMibConfig(patch: Partial<MibConfig>): Promise<void> {
  const entries: [string, string][] = [];
  if (patch.sims !== undefined) {
    entries.push([K.sims, JSON.stringify(patch.sims)]);
    // Eski kalitlar ham mos tursin (orqaga qaytarilgan kod / tashqi skriptlar yagona raqamni o'qiy olsin).
    entries.push([K.phone, patch.sims.find((x) => x.state === 'on')?.phone ?? '']);
    entries.push([K.phonePending, '']);
  }
  if (patch.baseUrl !== undefined) entries.push([K.baseUrl, patch.baseUrl]);
  if (patch.intervalSec !== undefined) entries.push([K.intervalSec, String(patch.intervalSec)]);
  if (patch.deepDetail !== undefined) entries.push([K.deepDetail, patch.deepDetail ? '1' : '0']);
  if (patch.smsTimeoutSec !== undefined) entries.push([K.smsTimeoutSec, String(patch.smsTimeoutSec)]);
  for (const [key, value] of entries) {
    await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
}

/** Yangi SIM uchun qisqa, takrorlanmas id (webhook manzilida ishlatiladi): s1, s2, … */
function nextSimId(sims: MibSim[]): string {
  for (let i = 1; ; i++) if (!sims.some((x) => x.id === `s${i}`)) return `s${i}`;
}

/** SIM qo'shadi — 'pending' holatda (SMS so'ralmaydi) : faqat shu raqamdan SMS kelgach yoki operator
 *  qo'lda yoqqach ishlaydi. Xato terilgan raqam OTP oqimini jimgina sindirmasin. */
export async function addSim(phoneRaw: string, label?: string): Promise<{ ok: true; sim: MibSim } | { ok: false; error: string }> {
  const phone = digitsOnly(phoneRaw);
  if (phone.length !== 12 || !phone.startsWith('998')) return { ok: false, error: 'Telefon raqami +998 va 9 ta raqamdan iborat boʻlishi kerak' };
  const { sims } = await getMibConfig();
  if (sims.some((x) => x.phone === phone)) return { ok: false, error: 'Bu raqam allaqachon qoʻshilgan' };
  if (sims.length >= MAX_SIMS) return { ok: false, error: `Koʻpi bilan ${MAX_SIMS} ta SIM ulash mumkin` };
  const id = nextSimId(sims);
  const sim: MibSim = { id, phone, label: (label || '').trim().slice(0, 30) || `SIM ${id.slice(1)}`, state: 'pending', addedAt: new Date().toISOString() };
  await setMibConfig({ sims: [...sims, sim] });
  return { ok: true, sim };
}

export async function updateSim(id: string, patch: { state?: 'on' | 'off'; label?: string }): Promise<boolean> {
  const { sims } = await getMibConfig();
  const sim = sims.find((x) => x.id === id);
  if (!sim) return false;
  if (patch.state) sim.state = patch.state;
  if (typeof patch.label === 'string' && patch.label.trim()) sim.label = patch.label.trim().slice(0, 30);
  await setMibConfig({ sims });
  return true;
}

export async function removeSim(id: string): Promise<boolean> {
  const { sims } = await getMibConfig();
  if (!sims.some((x) => x.id === id)) return false;
  await setMibConfig({ sims: sims.filter((x) => x.id !== id) });
  return true;
}

/**
 * SMS keldi — bu o'sha SIM (va uning forwarder'i) ishlayotganining isboti: 'pending' SIM 'on' bo'ladi.
 *   simId berilgan (webhook `?sim=`) → aynan o'sha SIM;
 *   simId yo'q (belgisiz, eski manzil) → faqat BITTA kutayotgan SIM bo'lsa o'sha (qaysi biri ekani aniq).
 * Qaytaradi: tasdiqlangan raqam yoki null.
 */
export async function confirmSimBySms(simId: string | null): Promise<string | null> {
  const { sims } = await getMibConfig();
  const pending = sims.filter((x) => x.state === 'pending');
  const sim = simId ? pending.find((x) => x.id === simId) : pending.length === 1 ? pending[0] : undefined;
  if (!sim) return null;
  sim.state = 'on';
  await setMibConfig({ sims });
  return sim.phone;
}

/** Forwarder matnidan SIM slot raqami: «на номер SIM 2», «SIM2», «sim slot 1», «SIM-1». Topilmasa null. */
export function parseSimSlot(raw: string | null | undefined): number | null {
  const m = String(raw ?? '').match(/\bSIM\s*(?:slot\s*)?[-#:]?\s*([1-9])\b/i);
  return m ? Number(m[1]) : null;
}

/** Slot → SIM id (faqat slotini bilgan SIMlar). Webhook belgisiz SMS'ni shu orqali SIMga bog'laydi. */
export async function simIdForSlot(slot: number | null): Promise<string | null> {
  if (!slot) return null;
  const { sims } = await getMibConfig();
  return sims.find((x) => x.slot === slot)?.id ?? null;
}

/**
 * Slotni o'rganish: avtomator `simId` ga so'ralgan ish uchun kodni TO'G'RI deb tasdiqladi va o'sha SMS
 * `slot` dan kelgan — demak shu SIM o'sha slotda. Faqat hali hech kimga berilmagan slot yoziladi (boshqa
 * SIMda turgan bo'lsa — o'sha SIMdan olinadi, chunki yangi dalil kuchliroq). O'zgarsa true.
 */
export async function learnSimSlot(simId: string, slot: number): Promise<boolean> {
  const { sims } = await getMibConfig();
  const sim = sims.find((x) => x.id === simId);
  if (!sim || sim.slot === slot) return false;
  for (const x of sims) if (x.id !== simId && x.slot === slot) delete x.slot;
  sim.slot = slot;
  await setMibConfig({ sims });
  return true;
}

/** Webhook `?sim=` qiymati — faqat qisqa harf-raqam (bazaga begona matn yozilmasin). */
export const cleanSimId = (v: string | null | undefined): string | null => {
  const s = String(v ?? '').trim().toLowerCase();
  return /^[a-z0-9]{1,12}$/.test(s) ? s : null;
};

export interface ActiveSim { id: string; phone: string; label: string; tagged: boolean }
/**
 * Avtomator ishlatadigan SIMlar (state 'on'). `tagged` — shu SIMning O'Z webhook manzilidan
 * (`?sim=<id>`) kamida bitta SMS kelgan: ya'ni uning kodlari boshqalarnikidan ajratiladi.
 */
export async function getActiveSims(): Promise<ActiveSim[]> {
  const { sims } = await getMibConfig();
  const on = sims.filter((x) => x.state === 'on');
  if (on.length === 0) return [];
  const seen = await prisma.mibSms.groupBy({ by: ['sim'], where: { sim: { in: on.map((x) => x.id) } }, _count: { _all: true } }).catch(() => []);
  const tagged = new Set(seen.map((r) => r.sim));
  return on.map((x) => ({ id: x.id, phone: x.phone, label: x.label, tagged: tagged.has(x.id) }));
}
