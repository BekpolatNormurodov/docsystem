import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('hashes and verifies', async () => {
    const hash = await hashPassword('secret123');
    expect(hash).not.toBe('secret123');
    expect(await verifyPassword('secret123', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });
});

/*
  The SEED_PASSWORD suite is gone with the function it covered. It guarded against the seed giving
  every account one password written in this public repository; the seed now issues a separate
  random one per account, so the shared default it protected against no longer exists.
*/
