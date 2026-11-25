// role-service (markaziy login) bilan SSO. Hammasi ROLE_SERVICE_JWT_SECRET bo'lsa ishlaydi; bo'sh bo'lsa
// hech narsa o'zgarmaydi. Bu fayl sof mantiq (prisma/next import yo'q) — test qilinadi; route'lar uni chaqiradi.
import { jwtVerify } from 'jose';

/** role-service brauzerga qo'yadigan access cookie nomi (Domain=.mko-crm.uz). */
export const ROLE_SERVICE_COOKIE = 'mko_session';
export const ROLE_SERVICE_REFRESH_COOKIE = 'mko_session_refresh';

type Env = Record<string, string | undefined>;

export const ssoEnabled = (env: Env = process.env) => !!env.ROLE_SERVICE_JWT_SECRET?.trim();
const issuerOf = (env: Env) => env.ROLE_SERVICE_ISSUER?.trim() || 'role-service';

export type YuristGrant = 'ADMIN' | 'YURIST';
export interface RoleServiceClaims {
  sub: string;
  login: string;
  name: string;
  grants: Record<string, unknown>;
}

/** Access tokenni tekshiradi: faqat HS256, imzo, muddat, issuer, typ='access'. Yaroqsiz bo'lsa null (hech qachon throw qilmaydi). */
export async function verifyRoleServiceToken(token: string | undefined | null, env: Env = process.env): Promise<RoleServiceClaims | null> {
  const secret = env.ROLE_SERVICE_JWT_SECRET?.trim();
  if (!secret || !token) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ['HS256'], issuer: issuerOf(env) });
    if (payload.typ !== 'access') return null;
    if (typeof payload.sub !== 'string' || !payload.sub) return null;
    if (typeof payload.login !== 'string' || !payload.login.trim()) return null;
    const role = payload.role as { grants?: unknown } | undefined;
    const grants = role && typeof role === 'object' && role.grants && typeof role.grants === 'object' && !Array.isArray(role.grants) ? (role.grants as Record<string, unknown>) : {};
    return { sub: payload.sub, login: payload.login.trim(), name: typeof payload.name === 'string' ? payload.name : '', grants };
  } catch {
    return null;
  }
}

/** Bu servisdagi (docsystem = «yurist») huquq. Yo'q yoki boshqacha qiymat => kirish yo'q. */
export function yuristGrant(claims: Pick<RoleServiceClaims, 'grants'>): YuristGrant | null {
  const g = claims.grants.yurist;
  return g === 'ADMIN' || g === 'YURIST' ? g : null;
}

/** Faqat shu saytning ichki yo'li; «//», «/\», absolyut URL va boshqaruv belgilari rad etiladi. */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || next.length > 2000) return null;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null;
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return null;
  return next;
}

export interface SsoAdminRow {
  id: number;
  username: string;
  role: string;
  fullName: string | null;
  steps: unknown;
  active: boolean;
  roleServiceId: string | null;
}
export interface SsoDb {
  admin: {
    findUnique(args: { where: { roleServiceId: string } | { username: string } }): Promise<SsoAdminRow | null>;
    update(args: { where: { id: number }; data: { roleServiceId: string } }): Promise<SsoAdminRow>;
    create(args: { data: { username: string; passwordHash: string; role: string; fullName: string | null; steps: never[]; active: true; roleServiceId: string } }): Promise<SsoAdminRow>;
  };
}
export type SsoResult = { ok: true; admin: SsoAdminRow; created: boolean } | { ok: false; reason: 'no_grant' | 'inactive' | 'conflict' };

/**
 * Token egasiga mos Admin qatorini topadi/bog'laydi/yaratadi.
 *  - huquq (`grants.yurist`) yo'q => kirish yo'q;
 *  - roleServiceId bo'yicha topiladi; bo'lmasa username==login bo'yicha (BOSHQA roleServiceId bilan bog'langan bo'lsa — rad);
 *  - topilmasa yaratiladi: roli grant'dan, steps BO'SH (qo'shimcha huquq berilmaydi), parol — hech kim bilmaydigan hash;
 *  - MAVJUD adminning roli tokendan HECH QACHON o'zgartirilmaydi (mahalliy rol ustun);
 *  - nofaol admin kira olmaydi.
 */
export async function resolveSsoAdmin(db: SsoDb, claims: RoleServiceClaims, unusablePasswordHash: string): Promise<SsoResult> {
  const grant = yuristGrant(claims);
  if (!grant) return { ok: false, reason: 'no_grant' };

  let admin = await db.admin.findUnique({ where: { roleServiceId: claims.sub } });
  let created = false;
  if (!admin) {
    const byName = await db.admin.findUnique({ where: { username: claims.login } });
    if (byName) {
      if (byName.roleServiceId && byName.roleServiceId !== claims.sub) return { ok: false, reason: 'conflict' };
      admin = byName.roleServiceId ? byName : await db.admin.update({ where: { id: byName.id }, data: { roleServiceId: claims.sub } });
    } else {
      try {
        admin = await db.admin.create({
          data: { username: claims.login, passwordHash: unusablePasswordHash, role: grant, fullName: claims.name || null, steps: [], active: true, roleServiceId: claims.sub },
        });
        created = true;
      } catch {
        // Parallel so'rov oldin yaratib qo'ygan bo'lishi mumkin (unique) — qayta o'qiymiz.
        admin = await db.admin.findUnique({ where: { roleServiceId: claims.sub } });
        if (!admin) throw new Error('sso: admin yaratib bo‘lmadi');
      }
    }
  }
  if (!admin.active) return { ok: false, reason: 'inactive' };
  return { ok: true, admin, created };
}

/**
 * Kirishdan keyin (best effort): shu login/parol bilan role-service'dan token oladi, shunda boshqa servislar (kadr) ham
 * kirgan deb biladi. Har qanday xato yutiladi; parol va tokenlar HECH QACHON log qilinmaydi.
 */
export async function bridgeLogin(
  username: string,
  password: string,
  env: Env = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<{ accessToken: string; expiresIn: number } | null> {
  const base = env.ROLE_SERVICE_URL?.trim().replace(/\/+$/, '');
  if (!base || !ssoEnabled(env)) return null;
  try {
    const res = await fetchImpl(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: username, password }),
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as { accessToken?: unknown; expiresIn?: unknown };
    if (typeof d.accessToken !== 'string') return null;
    return { accessToken: d.accessToken, expiresIn: typeof d.expiresIn === 'number' && d.expiresIn > 0 ? d.expiresIn : 900 };
  } catch {
    console.warn('role-service bridge: ulanib bo‘lmadi'); // sabab/ma'lumot yozilmaydi
    return null;
  }
}
