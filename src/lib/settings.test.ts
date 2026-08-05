import { describe, it, expect, afterEach } from 'vitest';
import { prisma } from './db';
import { getSettings, setSetting } from './settings';

describe('settings', () => {
  afterEach(async () => {
    await prisma.setting.deleteMany({
      where: { key: { in: ['courtName', 'contractType', 'signerPosition', 'signerName', 'executorName', 'executorPhone'] } },
    });
  });

  it('returns defaults when no rows exist', async () => {
    const s = await getSettings();
    expect(s.courtName).toBe('Fuqarolik ishlari boʻyicha Uchtepa tumanlararo sudiga');
    expect(s.contractType).toBe('ONLAYN');
    expect(s.signerPosition).toBe('Boshqarma boshligʻi oʻrinbosari');
    expect(s.signerName).toBe('B.Babamuradov');
    expect(s.executorName).toBe('B.Fayziyev');
    expect(s.executorPhone).toBe('+99895-144-24-00');
  });

  it('upsert then read overrides default', async () => {
    await setSetting('courtName', 'Test sudiga');
    const s = await getSettings();
    expect(s.courtName).toBe('Test sudiga');
    // second upsert should update, not duplicate
    await setSetting('courtName', 'Boshqa sud');
    const s2 = await getSettings();
    expect(s2.courtName).toBe('Boshqa sud');
  });
});
