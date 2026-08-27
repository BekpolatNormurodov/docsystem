// Markaziy «kerakli hujjatlar» — Hujjatlar bo'limida boshqariladi, migratsiyasiz (fayl diskda,
// metadata `Setting` key/value da, billing-check ownAmounts / mib config bilan bir xil uslub).
//
// Portfel = MAJBURIY (bu import qilingan Snapshot — alohida saqlanadi, shu yerda faqat holati o'qiladi).
// Talabnoma / Sud hujjatlari = IXTIYORIY qo'shimcha fayllar: yuklanmagan bo'lsa, tegishli step
// sahifasi tepasida ogohlantirish chiqadi (lekin ishni to'xtatmaydi — shuning uchun ixtiyoriy).
import { prisma } from '@/lib/db';
import fs from 'node:fs/promises';
import path from 'node:path';

// Ixtiyoriy step-hujjatlari (portfel bu ro'yxatda emas — u Snapshot orqali keladi).
export const APP_DOC_KEYS = ['talabnoma', 'sud'] as const;
export type AppDocKey = (typeof APP_DOC_KEYS)[number];
export const isAppDocKey = (k: unknown): k is AppDocKey => APP_DOC_KEYS.includes(k as AppDocKey);

export const APP_DOC_LABEL: Record<AppDocKey, string> = {
  talabnoma: 'Talabnoma ro‘yxati',
  sud: 'Sud hujjati',
};

const SKEY = (k: AppDocKey) => `appDoc.${k}`;
export const APP_DOCS_DIR = path.join(process.cwd(), 'exports', 'app-docs');

export interface AppDocMeta {
  label: string;
  filePath: string;
  uploadedAt: string; // ISO
  size?: number; // bytes — UI da MB ko'rsatish uchun
}

export async function getAppDoc(k: AppDocKey): Promise<AppDocMeta | null> {
  const row = await prisma.setting.findUnique({ where: { key: SKEY(k) } });
  if (!row?.value) return null;
  try {
    const m = JSON.parse(row.value) as AppDocMeta;
    return m && m.filePath ? m : null;
  } catch {
    return null;
  }
}

export async function setAppDoc(k: AppDocKey, meta: AppDocMeta): Promise<void> {
  await prisma.setting.upsert({
    where: { key: SKEY(k) },
    create: { key: SKEY(k), value: JSON.stringify(meta) },
    update: { value: JSON.stringify(meta) },
  });
}

export async function clearAppDoc(k: AppDocKey): Promise<void> {
  const cur = await getAppDoc(k);
  if (cur?.filePath) await fs.rm(cur.filePath, { force: true }).catch(() => {});
  await prisma.setting.deleteMany({ where: { key: SKEY(k) } });
}

export interface AppDocFile {
  present: boolean;
  label: string | null;
  uploadedAt: string | null;
  size: number | null; // bytes
}
export interface AppDocsStatus {
  // Portfel — MAJBURIY: hech bo'lmaganda bitta READY snapshot bo'lishi kerak.
  portfel: { present: boolean; count: number };
  // Ixtiyoriylar — yuklangan bo'lsa nomi, hajmi (bytes), sana.
  talabnoma: AppDocFile;
  sud: AppDocFile;
}

const fileOf = (m: AppDocMeta | null): AppDocFile => ({
  present: !!m,
  label: m?.label ?? null,
  uploadedAt: m?.uploadedAt ?? null,
  size: m?.size ?? null,
});

export async function appDocsStatus(): Promise<AppDocsStatus> {
  const [portfelCount, tal, sud] = await Promise.all([
    prisma.snapshot.count({ where: { status: 'READY' } }),
    getAppDoc('talabnoma'),
    getAppDoc('sud'),
  ]);
  return {
    portfel: { present: portfelCount > 0, count: portfelCount },
    talabnoma: fileOf(tal),
    sud: fileOf(sud),
  };
}
