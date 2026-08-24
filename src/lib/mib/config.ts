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
} as const;

export interface MibConfig {
  /** ISHLAYOTGAN raqam — faqat shu raqamdan test SMS kelgach o'zgaradi. */
  phone: string;
  /** Kiritilgan, lekin hali SMS bilan tasdiqlanmagan raqam. */
  phonePending: string;
  phoneConfirmedAt: string;
  baseUrl: string;
  intervalSec: number;
}

// Interval kamida 60 soniya: MIB avtomatori har mijoz uchun captcha + so'rovlar qiladi,
// undan tez-tez urish bloklanishga olib keladi.
export const MIN_INTERVAL_SEC = 60;
const DEFAULTS: MibConfig = { phone: '', phonePending: '', phoneConfirmedAt: '', baseUrl: 'https://mib.uz', intervalSec: 60 };

export async function getMibConfig(): Promise<MibConfig> {
  const rows = await prisma.setting.findMany({ where: { key: { in: Object.values(K) } } });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const intervalSec = Number(map.get(K.intervalSec));
  return {
    phone: map.get(K.phone) || DEFAULTS.phone,
    phonePending: map.get(K.phonePending) || DEFAULTS.phonePending,
    phoneConfirmedAt: map.get(K.phoneConfirmedAt) || DEFAULTS.phoneConfirmedAt,
    baseUrl: map.get(K.baseUrl) || DEFAULTS.baseUrl,
    intervalSec: Number.isFinite(intervalSec) && intervalSec >= MIN_INTERVAL_SEC ? intervalSec : DEFAULTS.intervalSec,
  };
}

export async function setMibConfig(patch: Partial<MibConfig>): Promise<void> {
  const entries: [string, string][] = [];
  if (patch.phone !== undefined) entries.push([K.phone, patch.phone]);
  if (patch.phonePending !== undefined) entries.push([K.phonePending, patch.phonePending]);
  if (patch.phoneConfirmedAt !== undefined) entries.push([K.phoneConfirmedAt, patch.phoneConfirmedAt]);
  if (patch.baseUrl !== undefined) entries.push([K.baseUrl, patch.baseUrl]);
  if (patch.intervalSec !== undefined) entries.push([K.intervalSec, String(patch.intervalSec)]);
  for (const [key, value] of entries) {
    await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
}

/**
 * Kutilayotgan raqamni ISHLAYOTGAN raqamga aylantiradi — faqat shu raqamdan (uning
 * forwarder'idan) haqiqiy SMS kelganda chaqiriladi. Boshqa hech qanday yo'l bilan
 * `mib.phone` o'zgarmaydi: shunchaki maydonni tahrirlab «Saqlash» bosish yetarli emas.
 */
export async function confirmPendingPhone(): Promise<string | null> {
  const cfg = await getMibConfig();
  if (!cfg.phonePending) return null;
  await setMibConfig({ phone: cfg.phonePending, phonePending: '', phoneConfirmedAt: new Date().toISOString() });
  return cfg.phonePending;
}
