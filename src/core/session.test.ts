import { describe, it, expect } from 'vitest';
import { SignJWT } from 'jose';
import { Role } from './enums';
import { createSession, verifySession } from './session';

const payload = { sub: 'u1', login: 'yurist', role: Role.YURIST, fullName: 'Test Yurist' };

describe('session', () => {
  it('round-trips a signed session', async () => {
    const token = await createSession(payload);
    const back = await verifySession(token);
    expect(back?.login).toBe('yurist');
    expect(back?.role).toBe(Role.YURIST);
  });

  it('returns null for a missing or bad token', async () => {
    expect(await verifySession(undefined)).toBeNull();
    expect(await verifySession('not.a.jwt')).toBeNull();
  });

  it('returns null when the role claim is not a valid Role', async () => {
    const secret = new TextEncoder().encode('dev-secret-change-me-min-32-chars-long!!');
    const token = await new SignJWT({ login: 'x', role: 'HACKER', fullName: 'X' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('u9')
      .sign(secret);
    expect(await verifySession(token)).toBeNull();
  });
});

/**
 * The failure these guard against has no symptom: with a published AUTH_SECRET the app boots,
 * logins work, and every session is forgeable by anyone who has read the repo.
 */
describe('AUTH_SECRET in production', () => {
  const withEnv = async (env: Record<string, string | undefined>, fn: () => Promise<unknown>) => {
    const prev = { ...process.env };
    Object.assign(process.env, env);
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
    try {
      return await fn();
    } finally {
      process.env = prev;
    }
  };

  it('refuses to sign when it is unset', async () => {
    await withEnv({ NODE_ENV: 'production', AUTH_SECRET: undefined }, async () => {
      await expect(createSession(payload)).rejects.toThrow(/AUTH_SECRET is not set/);
    });
  });

  it('refuses the value shipped in .env.example', async () => {
    await withEnv(
      { NODE_ENV: 'production', AUTH_SECRET: 'change-me-to-a-long-random-string-min-32-chars' },
      async () => {
        await expect(createSession(payload)).rejects.toThrow(/published example/);
      },
    );
  });

  it('refuses the dev fallback baked into the source', async () => {
    await withEnv(
      { NODE_ENV: 'production', AUTH_SECRET: 'dev-secret-change-me-min-32-chars-long!!' },
      async () => {
        await expect(createSession(payload)).rejects.toThrow(/published example/);
      },
    );
  });

  it('refuses a secret shorter than the HS256 hash', async () => {
    await withEnv({ NODE_ENV: 'production', AUTH_SECRET: 'too-short' }, async () => {
      await expect(createSession(payload)).rejects.toThrow(/shorter than 32/);
    });
  });

  it('accepts a real secret', async () => {
    await withEnv(
      { NODE_ENV: 'production', AUTH_SECRET: 'K7pQ2xR9mL4vN8wZ1yT6bH3jF5sD0aG7cE2u' },
      async () => {
        expect(await verifySession(await createSession(payload))).not.toBeNull();
      },
    );
  });

  it('stays convenient in development', async () => {
    await withEnv({ NODE_ENV: 'development', AUTH_SECRET: undefined }, async () => {
      expect(await verifySession(await createSession(payload))).not.toBeNull();
    });
  });
});
