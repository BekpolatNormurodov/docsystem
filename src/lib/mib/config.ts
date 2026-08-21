// MIB module settings, stored in the shared Setting key/value table (like the davlat-boji setting).
// «nomer ulaydigan joy» = the phone number the OTP is sent to (set in admin); the mobile forwards the
// SMS to /api/mib-webhook.
import { prisma } from '@/lib/db';

const K = {
  phone: 'mib.phone',
  baseUrl: 'mib.baseUrl',
  intervalSec: 'mib.intervalSec',
} as const;

export interface MibConfig {
  phone: string;
  baseUrl: string;
  intervalSec: number;
}

const DEFAULTS: MibConfig = { phone: '', baseUrl: 'https://mib.uz', intervalSec: 60 };

export async function getMibConfig(): Promise<MibConfig> {
  const rows = await prisma.setting.findMany({ where: { key: { in: Object.values(K) } } });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const intervalSec = Number(map.get(K.intervalSec));
  return {
    phone: map.get(K.phone) || DEFAULTS.phone,
    baseUrl: map.get(K.baseUrl) || DEFAULTS.baseUrl,
    intervalSec: Number.isFinite(intervalSec) && intervalSec >= 10 ? intervalSec : DEFAULTS.intervalSec,
  };
}

export async function setMibConfig(patch: Partial<MibConfig>): Promise<void> {
  const entries: [string, string][] = [];
  if (patch.phone !== undefined) entries.push([K.phone, patch.phone]);
  if (patch.baseUrl !== undefined) entries.push([K.baseUrl, patch.baseUrl]);
  if (patch.intervalSec !== undefined) entries.push([K.intervalSec, String(patch.intervalSec)]);
  for (const [key, value] of entries) {
    await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
}
