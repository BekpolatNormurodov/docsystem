// Pure access-control vocabulary — no prisma, no next imports, so BOTH the client
// (sidebar builds its nav from this) and the server (guards) share one source of
// truth for what the five pipeline steps are and who may touch them.

export const STEP_KEYS = ['talabnoma', 'ariza', 'invoice', 'sud', 'mib'] as const;
export type StepKey = (typeof STEP_KEYS)[number];

export interface StepMeta {
  step: number; // 1..5, the pipeline position (kept stable even when a yurist has only one)
  label: string;
  href: string;
  icon: string; // NAV_ICONS key
}

// Order == pipeline order == STEP_KEYS order. Labels mirror the old NAV in layout.tsx.
export const STEP_META: Record<StepKey, StepMeta> = {
  talabnoma: { step: 1, label: 'Talabnoma', href: '/talabnoma', icon: 'files' },
  ariza: { step: 2, label: 'Ariza · palata', href: '/ariza', icon: 'pen' },
  invoice: { step: 3, label: 'Invoice · buxgalteriya', href: '/invoice', icon: 'file-plus' },
  sud: { step: 4, label: 'Sud (adolat)', href: '/sud', icon: 'building' },
  mib: { step: 5, label: 'MIB · ijro', href: '/mib', icon: 'check' },
};

export type AppRole = 'ADMIN' | 'YURIST';

export interface AppUser {
  id: number;
  username: string;
  role: AppRole;
  fullName: string;
  steps: StepKey[]; // YURIST: granted steps; ADMIN: implicitly all
  active: boolean;
}

/** Normalize whatever is stored in Admin.steps (Json) into a clean StepKey[]. */
export function parseSteps(raw: unknown): StepKey[] {
  const arr = Array.isArray(raw) ? raw : [];
  return STEP_KEYS.filter((k) => arr.includes(k));
}

export function isAdmin(u: Pick<AppUser, 'role'>): boolean {
  return u.role === 'ADMIN';
}

/** ADMIN may touch every step; a YURIST only the ones granted. */
export function canStep(u: Pick<AppUser, 'role' | 'steps'>, key: StepKey): boolean {
  return u.role === 'ADMIN' || u.steps.includes(key);
}

/** The steps a user may actually open, in pipeline order. */
export function allowedSteps(u: Pick<AppUser, 'role' | 'steps'>): StepKey[] {
  return STEP_KEYS.filter((k) => canStep(u, k));
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
