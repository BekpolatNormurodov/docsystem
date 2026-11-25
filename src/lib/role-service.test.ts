import { describe, it, expect, vi } from 'vitest';
import { SignJWT } from 'jose';
import {
  bridgeLogin, resolveSsoAdmin, safeNext, ssoEnabled, verifyRoleServiceToken, yuristGrant,
  type SsoAdminRow, type SsoDb,
} from './role-service';

const SECRET = 'a'.repeat(40);
const env = { ROLE_SERVICE_JWT_SECRET: SECRET, ROLE_SERVICE_ISSUER: 'role-service' };
const key = (s = SECRET) => new TextEncoder().encode(s);

async function mint(over: { secret?: string; iss?: string; typ?: string; exp?: string | number; grants?: Record<string, string>; alg?: 'HS256' | 'HS384' } = {}) {
  return new SignJWT({ typ: over.typ ?? 'access', login: 'i.baxromjon', name: 'Ismoilov B', role: { key: 'x', grants: over.grants ?? { yurist: 'YURIST' } } })
    .setProtectedHeader({ alg: over.alg ?? 'HS256', typ: 'JWT' })
    .setSubject('ckuser1')
    .setIssuer(over.iss ?? 'role-service')
    .setIssuedAt()
    .setExpirationTime(over.exp ?? '15m')
    .sign(key(over.secret));
}

describe('verifyRoleServiceToken', () => {
  it('valid token', async () => {
    const c = await verifyRoleServiceToken(await mint(), env);
    expect(c).toMatchObject({ sub: 'ckuser1', login: 'i.baxromjon', name: 'Ismoilov B' });
    expect(yuristGrant(c!)).toBe('YURIST');
  });
  it('wrong secret', async () => expect(await verifyRoleServiceToken(await mint({ secret: 'b'.repeat(40) }), env)).toBeNull());
  it('wrong iss', async () => expect(await verifyRoleServiceToken(await mint({ iss: 'evil' }), env)).toBeNull());
  it('expired', async () => expect(await verifyRoleServiceToken(await mint({ exp: Math.floor(Date.now() / 1000) - 60 }), env)).toBeNull());
  it('typ refresh is not an access token', async () => expect(await verifyRoleServiceToken(await mint({ typ: 'refresh' }), env)).toBeNull());
  it('alg none and other algs are rejected', async () => {
    const good = await mint();
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${good.split('.')[1]}.`;
    expect(await verifyRoleServiceToken(none, env)).toBeNull();
    expect(await verifyRoleServiceToken(await mint({ alg: 'HS384' }), env)).toBeNull();
  });
  it('garbage / empty / disabled', async () => {
    expect(await verifyRoleServiceToken('abc', env)).toBeNull();
    expect(await verifyRoleServiceToken('', env)).toBeNull();
    expect(await verifyRoleServiceToken(await mint(), {})).toBeNull();
    expect(ssoEnabled({})).toBe(false);
    expect(ssoEnabled(env)).toBe(true);
  });
});

describe('yuristGrant', () => {
  it('missing or unknown grant => no access', () => {
    expect(yuristGrant({ grants: {} })).toBeNull();
    expect(yuristGrant({ grants: { kadr: 'xodim' } })).toBeNull();
    expect(yuristGrant({ grants: { yurist: 'RAHBAR' } })).toBeNull();
    expect(yuristGrant({ grants: { yurist: 'ADMIN' } })).toBe('ADMIN');
  });
});

describe('safeNext', () => {
  it('accepts internal paths only', () => {
    expect(safeNext('/sud?x=1')).toBe('/sud?x=1');
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', 'javascript:alert(1)', '', null, undefined, '/a\nb', 'evil']) expect(safeNext(bad as string)).toBeNull();
  });
});

function fakeDb(rows: SsoAdminRow[]) {
  const db: SsoDb = {
    admin: {
      findUnique: async ({ where }) => rows.find((r) => ('roleServiceId' in where ? r.roleServiceId === where.roleServiceId : r.username === where.username)) ?? null,
      update: async ({ where, data }) => { const r = rows.find((x) => x.id === where.id)!; Object.assign(r, data); return r; },
      create: async ({ data }) => { const r = { id: rows.length + 1, ...data } as SsoAdminRow; rows.push(r); return r; },
    },
  };
  return db;
}
const claims = (grants: Record<string, unknown> = { yurist: 'YURIST' }) => ({ sub: 'ckuser1', login: 'i.baxromjon', name: 'Ismoilov B', grants });
const row = (o: Partial<SsoAdminRow> = {}): SsoAdminRow => ({ id: 7, username: 'i.baxromjon', role: 'ADMIN', fullName: 'X', steps: ['sud'], active: true, roleServiceId: null, ...o });

describe('resolveSsoAdmin', () => {
  it('no yurist grant => refused, nothing created', async () => {
    const rows: SsoAdminRow[] = [];
    expect(await resolveSsoAdmin(fakeDb(rows), claims({ kadr: 'xodim' }), 'h')).toEqual({ ok: false, reason: 'no_grant' });
    expect(rows).toHaveLength(0);
  });
  it('creates a missing admin with the granted role and EMPTY steps', async () => {
    const rows: SsoAdminRow[] = [];
    const r = await resolveSsoAdmin(fakeDb(rows), claims({ yurist: 'YURIST' }), 'unusable-hash');
    expect(r.ok && r.created).toBe(true);
    expect(rows[0]).toMatchObject({ username: 'i.baxromjon', role: 'YURIST', steps: [], active: true, roleServiceId: 'ckuser1', passwordHash: 'unusable-hash' });
  });
  it('existing admin: linked by username, role NOT overridden by the token', async () => {
    const rows = [row({ role: 'ADMIN', steps: [] })];
    const r = await resolveSsoAdmin(fakeDb(rows), claims({ yurist: 'YURIST' }), 'h');
    expect(r.ok && r.admin.role).toBe('ADMIN');
    expect(rows[0].roleServiceId).toBe('ckuser1');
    const rows2 = [row({ role: 'YURIST', steps: ['sud'] })];
    const r2 = await resolveSsoAdmin(fakeDb(rows2), claims({ yurist: 'ADMIN' }), 'h');
    expect(r2.ok && r2.admin.role).toBe('YURIST');
    expect(rows2[0].steps).toEqual(['sud']);
  });
  it('same username already linked to ANOTHER role-service user => conflict', async () => {
    const rows = [row({ roleServiceId: 'someone-else' })];
    expect(await resolveSsoAdmin(fakeDb(rows), claims(), 'h')).toEqual({ ok: false, reason: 'conflict' });
    expect(rows[0].roleServiceId).toBe('someone-else');
  });
  it('inactive admin cannot enter', async () => {
    expect(await resolveSsoAdmin(fakeDb([row({ active: false, roleServiceId: 'ckuser1' })]), claims(), 'h')).toEqual({ ok: false, reason: 'inactive' });
  });
});

describe('bridgeLogin', () => {
  const e = { ...env, ROLE_SERVICE_URL: 'http://role-service:5300/' };
  it('returns the access token on 200, posting login/password', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ accessToken: 'tok', expiresIn: 900, refreshToken: 'r' }), { status: 200 }));
    expect(await bridgeLogin('u', 'p', e, f as unknown as typeof fetch)).toEqual({ accessToken: 'tok', expiresIn: 900 });
    expect(f).toHaveBeenCalledWith('http://role-service:5300/api/auth/login', expect.objectContaining({ method: 'POST', body: JSON.stringify({ login: 'u', password: 'p' }) }));
  });
  it('swallows failures and is off without url/secret', async () => {
    expect(await bridgeLogin('u', 'p', e, (async () => new Response('no', { status: 401 })) as unknown as typeof fetch)).toBeNull();
    expect(await bridgeLogin('u', 'p', e, (async () => { throw new Error('down'); }) as unknown as typeof fetch)).toBeNull();
    expect(await bridgeLogin('u', 'p', { ...env }, vi.fn() as unknown as typeof fetch)).toBeNull();
    expect(await bridgeLogin('u', 'p', { ROLE_SERVICE_URL: 'http://x' }, vi.fn() as unknown as typeof fetch)).toBeNull();
  });
});
