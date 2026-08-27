// Pure access-control vocabulary — no prisma, no next imports, so BOTH the client
// (sidebar builds its nav from this) and the server (guards) share one source of
// truth for what the five pipeline steps are and who may touch them.

// Four steps: invoice (buxgalteriya) is no longer its own step — it lives INSIDE Sud as a tab.
export const STEP_KEYS = ['talabnoma', 'ariza', 'sud', 'mib'] as const;
export type StepKey = (typeof STEP_KEYS)[number];

export interface StepMeta {
  step: number; // 1..5, the pipeline position (kept stable even when a yurist has only one)
  label: string;
  href: string;
  icon: string; // NAV_ICONS key
}

// Order == pipeline order == STEP_KEYS order. Labels mirror the old NAV in layout.tsx.
export const STEP_META: Record<StepKey, StepMeta> = {
  talabnoma: { step: 1, label: 'Talabnoma', href: '/talabnoma', icon: 'sms' },
  ariza: { step: 2, label: 'Sanoat palatasi', href: '/ariza', icon: 'stamp' },
  sud: { step: 3, label: 'Sud', href: '/sud', icon: 'court' },
  mib: { step: 4, label: 'MIB', href: '/mib', icon: 'shield' },
};

// «Alohida» modullar — pipeline bosqichi EMAS, lekin ular ham YURISTga alohida berilishi mumkin
// (foydalanuvchi so'rovi). Grant Admin.steps ichida SHU kalitlar bilan saqlanadi (StepKey bilan bir
// jadval). Sidebar pastida ko'rinadi, guardlari requireAccess(key) bilan tekshiriladi.
export const MODULE_KEYS = ['talabnoma-form', 'mib-report', 'invoice-check'] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];
export interface ModuleMeta { label: string; href: string; icon: string }
export const MODULE_META: Record<ModuleKey, ModuleMeta> = {
  'talabnoma-form': { label: 'Talabnoma shakllantirish', href: '/talabnoma-shakllantirish', icon: 'sms' },
  'mib-report': { label: 'MIB hisoboti', href: '/mib-hisoboti', icon: 'judge' },
  'invoice-check': { label: 'Invoice tekshiruvi', href: '/invoice-tekshiruvi', icon: 'receipt' },
};

// Ko'p sahifali bosqich ichidagi SUB-ITEM'lar — nozik ruxsat (foydalanuvchi so'rovi): yurist stepga
// to'liq ega bo'lmasa, faqat berilgan sub-item'ga kiradi; qolgani sidebar'da X (qulf). Kalit = 'step:sub'.
export const SUBITEM_KEYS = [
  'ariza:prepare', 'ariza:scan',
  'sud:invoice', 'sud:oferta', 'sud:send', 'sud:returns',
] as const;
export type SubItemKey = (typeof SUBITEM_KEYS)[number];
export const SUBITEM_META: Record<SubItemKey, { step: StepKey; href: string; label: string }> = {
  'ariza:prepare': { step: 'ariza', href: '/ariza', label: 'Arizani tayyorlash' },
  'ariza:scan': { step: 'ariza', href: '/ariza/skaner', label: 'Arizalarni skanerlash' },
  'sud:invoice': { step: 'sud', href: '/sud/invoice', label: 'Invoice yaratish' },
  'sud:oferta': { step: 'sud', href: '/sud/oferta', label: 'Oferta tayyorlash' },
  'sud:send': { step: 'sud', href: '/sud', label: 'Sudga yuborish' },
  'sud:returns': { step: 'sud', href: '/sud/qaytganlar', label: 'Qaytganlar' },
};
// Qaysi bosqich sub-item darajasida beriladi (talabnoma/mib — bitta sahifa, butun-bosqich grant).
export const STEP_SUBITEMS: Partial<Record<StepKey, SubItemKey[]>> = {
  ariza: ['ariza:prepare', 'ariza:scan'],
  sud: ['sud:invoice', 'sud:oferta', 'sud:send', 'sud:returns'],
};

// Har qanday ruxsat kaliti — Admin.steps shu qiymatlarni saqlaydi (bosqich / sub-item / modul).
export type AccessKey = StepKey | ModuleKey | SubItemKey;
export const ACCESS_KEYS: AccessKey[] = [...STEP_KEYS, ...MODULE_KEYS, ...SUBITEM_KEYS];
const SUBITEM_PARENT: Record<string, StepKey | undefined> = Object.fromEntries(
  SUBITEM_KEYS.map((k) => [k, SUBITEM_META[k].step]),
);

export type AppRole = 'ADMIN' | 'YURIST';

export interface AppUser {
  id: number;
  username: string;
  role: AppRole;
  fullName: string;
  steps: AccessKey[]; // YURIST: granted steps + modules; ADMIN: implicitly all
  active: boolean;
}

/** Normalize whatever is stored in Admin.steps (Json) into clean access keys (steps + modules). */
export function parseSteps(raw: unknown): AccessKey[] {
  const arr = Array.isArray(raw) ? raw : [];
  return ACCESS_KEYS.filter((k) => arr.includes(k));
}

export function isAdmin(u: Pick<AppUser, 'role'>): boolean {
  return u.role === 'ADMIN';
}

/** ADMIN — hammasi. YURIST — kalit berilgan bo'lsa, YOKI (sub-item bo'lsa) ota-bosqichi berilgan bo'lsa. */
export function canAccess(u: Pick<AppUser, 'role' | 'steps'>, key: AccessKey): boolean {
  if (u.role === 'ADMIN') return true;
  if (u.steps.includes(key)) return true;
  const parent = SUBITEM_PARENT[key]; // sub-item bo'lsa — ota-bosqich to'liq berilsa ham ochiladi
  return parent ? u.steps.includes(parent) : false;
}
/** Alias — bosqich guardlari uchun. */
export const canStep = canAccess;

/** Bosqich sidebar'da OCHILADIMI: butun-bosqich berilgan yoki uning bironta sub-item'i berilgan. */
export function canOpenStep(u: Pick<AppUser, 'role' | 'steps'>, step: StepKey): boolean {
  if (u.role === 'ADMIN' || u.steps.includes(step)) return true;
  return (STEP_SUBITEMS[step] ?? []).some((k) => u.steps.includes(k));
}

/** Foydalanuvchi ko'radigan bosqichlar (pipeline tartibida). */
export function allowedSteps(u: Pick<AppUser, 'role' | 'steps'>): StepKey[] {
  return STEP_KEYS.filter((k) => canOpenStep(u, k));
}

/** The «Alohida» modules a user may open (bottom of the sidebar). */
export function allowedModules(u: Pick<AppUser, 'role' | 'steps'>): ModuleKey[] {
  return MODULE_KEYS.filter((k) => u.role === 'ADMIN' || u.steps.includes(k));
}

/** Where to send a user who lands somewhere they may not see. Admin → Hisobot;
 *  yurist → their first granted step; nobody-granted → null (caller decides). */
export function landingHref(u: Pick<AppUser, 'role' | 'steps'>): string | null {
  if (u.role === 'ADMIN') return '/konveyer';
  // Birinchi KIRA OLADIGAN sahifa: butun-bosqich bo'lsa o'z sahifasi, aks holda birinchi berilgan sub-item.
  for (const step of STEP_KEYS) {
    if (u.steps.includes(step)) return STEP_META[step].href;
    const sub = (STEP_SUBITEMS[step] ?? []).find((k) => u.steps.includes(k));
    if (sub) return SUBITEM_META[sub].href;
  }
  // Faqat «Alohida» modul berilgan YURIST (masalan invoice-check) — o'sha modulga tushadi.
  const mod = allowedModules(u)[0];
  return mod ? MODULE_META[mod].href : null;
}

/** Map a pathname back to the step it belongs to (for route-level guards). */
export function stepForPath(path: string): StepKey | null {
  return STEP_KEYS.find((k) => path === STEP_META[k].href || path.startsWith(STEP_META[k].href + '/')) ?? null;
}

export function roleLabel(role: AppRole): string {
  return role === 'ADMIN' ? 'Admin' : 'Yurist';
}
