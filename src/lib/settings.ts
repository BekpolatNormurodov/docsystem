import { prisma } from './db';
import { CHAMBER_SIGNER } from '@/core/chamber';

export interface Settings {
  courtName: string;
  contractType: string;
  signerPosition: string;
  signerName: string;
  executorName: string;
  executorPhone: string;
}

const DEFAULTS: Settings = {
  courtName: 'Fuqarolik ishlari boʻyicha Uchtepa tumanlararo sudiga',
  contractType: 'ONLAYN',
  signerPosition: CHAMBER_SIGNER.position,
  signerName: CHAMBER_SIGNER.name,
  executorName: CHAMBER_SIGNER.executorName,
  executorPhone: CHAMBER_SIGNER.executorPhone,
};

/** Reads all known Setting rows, falling back to defaults for any key not stored. */
export async function getSettings(): Promise<Settings> {
  const rows = await prisma.setting.findMany({
    where: { key: { in: Object.keys(DEFAULTS) } },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const result = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    const v = byKey.get(key);
    // A cleared (blank) value must fall back to the default — never emit an empty
    // required field (e.g. a bare "...sudiga" with no court) into a filed ariza.
    if (v !== undefined && v.trim() !== '') result[key] = v;
  }
  return result;
}

/** Upserts a single Setting key/value row. */
export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}
