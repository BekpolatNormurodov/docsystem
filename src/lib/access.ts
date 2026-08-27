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

// Har qanday ruxsat kaliti (bosqich yoki modul) — Admin.steps shu qiymatlarni saqlaydi.
export type AccessKey = StepKey | ModuleKey;
export const ACCESS_KEYS: AccessKey[] = [...STEP_KEYS, ...MODULE_KEYS];

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

/** ADMIN may touch everything; a YURIST only the steps/modules granted. */
export function canStep(u: Pick<AppUser, 'role' | 'steps'>, key: AccessKey): boolean {
  return u.role === 'ADMIN' || u.steps.includes(key);
}
/** Alias — reads clearer for the «Alohida» modules. */
export const canAccess = canStep;

/** The pipeline steps a user may actually open, in pipeline order. */
export function allowedSteps(u: Pick<AppUser, 'role' | 'steps'>): StepKey[] {
  return STEP_KEYS.filter((k) => canStep(u, k));
}

/** The «Alohida» modules a user may open (bottom of the sidebar). */
export function allowedModules(u: Pick<AppUser, 'role' | 'steps'>): ModuleKey[] {
  return MODULE_KEYS.filter((k) => canStep(u, k));
}

/** Where to send a user who lands somewhere they may not see. Admin → Hisobot;
 *  yurist → their first granted step; nobody-granted → null (caller decides). */
export function landingHref(u: Pick<AppUser, 'role' | 'steps'>): string | null {
  if (u.role === 'ADMIN') return '/konveyer';
  const first = allowedSteps(u)[0];
  return first ? STEP_META[first].href : null;
}

/** Map a pathname back to the step it belongs to (for route-level guards). */
export function stepForPath(path: string): StepKey | null {
  return STEP_KEYS.find((k) => path === STEP_META[k].href || path.startsWith(STEP_META[k].href + '/')) ?? null;
}

export function roleLabel(role: AppRole): string {
  return role === 'ADMIN' ? 'Admin' : 'Yurist';
}
