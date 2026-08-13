import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySession } from '@/core/session';
import { prisma } from '@/lib/db';
import { parseSteps, canStep, landingHref, type AppUser, type StepKey } from '@/lib/access';

/**
 * The signed-in user with LIVE authorization loaded from the DB.
 *
 * The JWT proves identity (login), but role/steps/active are read fresh every
 * request: an admin can change a yurist's granted steps or deactivate them, and
 * that must take effect on the next navigation without re-issuing the cookie.
 * Returns null when there is no valid session OR the account is deactivated.
 */
export async function currentUser(): Promise<AppUser | null> {
  const token = cookies().get('docsystem_session')?.value;
  const payload = await verifySession(token);
  if (!payload) return null;
  const row = await prisma.admin.findUnique({
    where: { username: payload.login },
    select: { id: true, username: true, role: true, fullName: true, steps: true, active: true },
  });
  if (!row || !row.active) return null;
  return {
    id: row.id,
    username: row.username,
    role: row.role === 'YURIST' ? 'YURIST' : 'ADMIN',
    fullName: row.fullName || row.username,
    steps: parseSteps(row.steps),
    active: row.active,
  };
}

/** Back-compat thin identity check (kept for any caller that only wants the login). */
export async function getSession(): Promise<{ username: string } | null> {
  const u = await currentUser();
  return u ? { username: u.username } : null;
}

/** Any logged-in, active user. Redirects to /login otherwise. */
export async function requireUser(): Promise<AppUser> {
  const u = await currentUser();
  if (!u) redirect('/login');
  return u;
}

/**
 * ADMIN only. A yurist who reaches an admin page is bounced to their own landing
 * (first granted step) instead of seeing a 403 — the sidebar never offered it, so
 * this only fires on a hand-typed URL. Signature stays compatible with the ~50
 * existing `const s = await requireAdmin()` callers (AppUser still has .username).
 */
export async function requireAdmin(): Promise<AppUser> {
  const u = await currentUser();
  if (!u) redirect('/login');
  if (u.role !== 'ADMIN') redirect(landingHref(u) ?? '/login');
  return u;
}

/** ADMIN, or a YURIST who has been granted this step. */
export async function requireStep(key: StepKey): Promise<AppUser> {
  const u = await currentUser();
  if (!u) redirect('/login');
  if (!canStep(u, key)) redirect(landingHref(u) ?? '/login');
  return u;
}
