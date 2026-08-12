import { describe, it, expect } from 'vitest';
import {
  maskAmount, unmaskAmount, maskPhone, unmaskPhone, maskPassport,
  maskStir, maskAccount, maskMfo, maskPinfl, isValidPinfl, maskDmy,
} from './mask';

describe('mask — amount', () => {
  it('space-groups thousands and strips leading zeros', () => {
    expect(maskAmount('4000000')).toBe('4 000 000');
    expect(maskAmount('4 000 000')).toBe('4 000 000');
    expect(maskAmount('12345')).toBe('12 345');
    expect(maskAmount('007')).toBe('7');
    expect(maskAmount('0')).toBe('0');
    expect(maskAmount('')).toBe('');
  });
  it('unmaskAmount returns bare digits', () => {
    expect(unmaskAmount('4 000 000')).toBe('4000000');
  });
});

describe('mask — phone (+998 XX XXX XX XX)', () => {
  it('formats full numbers with or without the 998 prefix', () => {
    expect(maskPhone('998901234567')).toBe('+998 90 123 45 67');
    expect(maskPhone('901234567')).toBe('+998 90 123 45 67');
  });
  it('keeps partial input partial and empty empty', () => {
    expect(maskPhone('9012')).toBe('+998 90 12');
    expect(maskPhone('')).toBe('');
  });
  it('unmaskPhone always yields +998…', () => {
    expect(unmaskPhone('+998 90 123 45 67')).toBe('+998901234567');
    expect(unmaskPhone('901234567')).toBe('+998901234567');
    expect(unmaskPhone('')).toBe('');
  });
});

describe('mask — legal identifiers', () => {
  it('passport = 2 upper letters + 7 digits, junk stripped', () => {
    expect(maskPassport('ae5348993')).toBe('AE5348993');
    expect(maskPassport('  AE-5348993xx')).toBe('AE5348993');
    expect(maskPassport('AE53489931234')).toBe('AE5348993'); // caps digits at 7
  });
  it('STIR = 9 digits, MFO = 5 digits', () => {
    expect(maskStir('201 800 518')).toBe('201800518');
    expect(maskStir('2018005189999')).toBe('201800518');
    expect(maskMfo('011839')).toBe('01183');
  });
  it('account = up to 20 digits grouped in 4s', () => {
    expect(maskAccount('20208000900000000001')).toBe('2020 8000 9000 0000 0001');
    expect(maskAccount('2020800090')).toBe('2020 8000 90');
  });
  it('PINFL = exactly 14 digits and validates', () => {
    expect(maskPinfl('30101931662970')).toBe('30101931662970');
    expect(maskPinfl('301019316629701234')).toBe('30101931662970');
    expect(isValidPinfl('30101931662970')).toBe(true);
    expect(isValidPinfl('3010')).toBe(false);
    expect(isValidPinfl('3010193166297a')).toBe(false);
  });
});

describe('mask — typed DD.MM.YYYY', () => {
  it('auto-dots digits and caps at a full date', () => {
    expect(maskDmy('17')).toBe('17');
    expect(maskDmy('1712')).toBe('17.12');
    expect(maskDmy('17122026')).toBe('17.12.2026');
    expect(maskDmy('171220269')).toBe('17.12.2026'); // 8-digit cap
  });
  it('keeps a separator the user just typed at a boundary', () => {
    expect(maskDmy('17.')).toBe('17.');
    expect(maskDmy('17.12.')).toBe('17.12.');
  });
});
