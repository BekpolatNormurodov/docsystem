import { describe, it, expect } from 'vitest';
import { prisma } from './db';

describe('db', () => {
  it('connects and counts admins', async () => {
    const n = await prisma.admin.count();
    expect(typeof n).toBe('number');
  });
});
