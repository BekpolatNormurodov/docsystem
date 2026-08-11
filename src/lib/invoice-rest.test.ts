import { describe, it, expect } from 'vitest';
import { buildFirmAddress, buildRestPayload } from './invoice-rest';
import type { Firm } from '@prisma/client';

const baseFirm = {
  id: 1,
  shortName: 'BRIGHT FUTURE FINANCING',
  legalName: 'BRIGHT FUTURE FINANCING MCHJ',
  region: 'Тошкент шаҳар',
  district: 'Олмазор тумани',
  addressLine: "Gurushariq MFY, Sag'bon kochasi 30-berk 7/1",
  stir: '311 976 75',
} as unknown as Firm;

describe('buildFirmAddress', () => {
  it('region + tuman + ko‘chani vergul bilan birlashtiradi', () => {
    expect(buildFirmAddress(baseFirm)).toBe(
      "Тошкент шаҳар, Олмазор тумани, Gurushariq MFY, Sag'bon kochasi 30-berk 7/1",
    );
  });

  it('bo‘sh qismlarni tashlab ketadi', () => {
    expect(buildFirmAddress({ region: 'A', district: null, addressLine: 'B' } as Firm)).toBe('A, B');
  });
});

describe('buildRestPayload', () => {
  it('konstantalarni saqlaydi, firmadan name/tin/address oladi', () => {
    const p = buildRestPayload(baseFirm);
    expect(p.amount).toBe(2060000);
    expect(p.courtId).toBe('525');
    expect(p.courtType).toBe('CITIZEN');
    expect(p.entityType).toBe('JURIDICAL');
    expect(p.payCategoryId).toBe(3);
    expect(p.isInFavor).toBe(true);
    expect(p.juridicalEntity.name).toBe('BRIGHT FUTURE FINANCING');
    expect(p.juridicalEntity.tin).toBe('31197675'); // probel/format tozalangan
    expect(p.juridicalEntity.address).toContain('Олмазор тумани');
  });

  it('shortName bo‘lmasa legalName ishlatiladi', () => {
    const p = buildRestPayload({ ...baseFirm, shortName: '' } as Firm);
    expect(p.juridicalEntity.name).toBe('BRIGHT FUTURE FINANCING MCHJ');
  });

  it('default summa 2 060 000 (pochta paketi)', () => {
    expect(buildRestPayload(baseFirm).amount).toBe(2060000);
  });

  it('boji uchun amount parametri qo‘llanadi, payCategoryId 3 o‘zgarmaydi', () => {
    const p = buildRestPayload(baseFirm, { amount: 20600 });
    expect(p.amount).toBe(20600);
    expect(p.payCategoryId).toBe(3);
    expect(p.courtType).toBe('CITIZEN');
    expect(p.juridicalEntity.name).toBe('BRIGHT FUTURE FINANCING');
  });
});
