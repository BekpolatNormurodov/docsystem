import { describe, it, expect } from 'vitest';
import { loanToAriza } from './ariza';
import type { Settings } from '@/lib/settings';

const loan = {
  clientName: 'Aliyeva Alifa',
  postAddress: 'Toshkent sh., Chilonzor',
  postAddressUz: 'Toshkent shahri, Chilonzor tumani',
  pinfl: '12345678901234',
  phone: '+998901234567',
  ldId: '22548',
  dateToCr: new Date('2026-04-14'),
  rate: 54,
  summKr: 10000000,
  debtPrincipal: 5000000,
  debtTermInterest: 200000,
  debtOverduePrincipal: 100000,
  debtOverdueInterest: 50000,
  totalDebt: 5350000,
};

const firm = {
  code: '12842',
  shortName: 'BRIGHT FUTURE FINANCING',
  legalName: 'Bright Future Financing MChJ',
  address: 'Toshkent sh.',
  bankAccount: '20216000207212842001',
  mfo: '00450',
  stir: '311976765',
};

const settings: Settings = {
  courtName: 'Fuqarolik ishlari boʻyicha Uchtepa tumanlararo sudiga',
  contractType: 'ONLAYN',
  signerPosition: 'Boshqarma boshligʻi oʻrinbosari',
  signerName: 'B.Babamuradov',
  executorName: 'B.Fayziyev',
  executorPhone: '+99895-144-24-00',
};

const reportDate = new Date('2026-08-01');

describe('loanToAriza', () => {
  it('maps loan/firm/settings into ariza document props', () => {
    const p = loanToAriza(loan, firm, settings, reportDate);

    expect(p.personFullName).toBe('Aliyeva Alifa');
    expect(p.personAddress).toBe('Toshkent shahri, Chilonzor tumani'); // prefers the clean Uzbek Latin address
    expect(p.personPinfl).toBe('12345678901234');
    expect(p.personPhone).toBe('+998901234567');
    expect(p.contracts).toEqual([{ number: '22548', date: loan.dateToCr }]);
    expect(p.contractType).toBe('ONLAYN');
    expect(p.interestRate).toBe('54');
    expect(p.loanAmount).toBe('10000000');
    expect(p.asOfDate).toBe(reportDate);
    expect(p.debtPrincipal).toBe('5000000');
    expect(p.debtTermInterest).toBe('200000');
    expect(p.debtOverduePrincipal).toBe('100000');
    expect(p.debtOverdueInterest).toBe('50000');
    expect(p.debtTotal).toBe('5350000');
    expect(p.courtName).toBe(settings.courtName);
    expect(p.chamberSignerPosition).toBe(settings.signerPosition);
    expect(p.chamberSignerName).toBe(settings.signerName);
    expect(p.chamberExecutorName).toBe(settings.executorName);
    expect(p.chamberExecutorPhone).toBe(settings.executorPhone);
    expect(p.number).toBe('');
    expect(p.issueDate).toBe(reportDate);

    expect(p.firm.name).toBe('BRIGHT FUTURE FINANCING');
    expect(p.firm.arizaName).toBe('Bright Future Financing MChJ');
    expect(p.firm.arizaAddress).toBe('Toshkent sh.');
    expect(p.firm.bankAccount).toBe('20216000207212842001');
    expect(p.firm.mfo).toBe('00450');
    expect(p.firm.stir).toBe('311976765');
  });

  it('falls back to shortName when firm has no legalName', () => {
    const p = loanToAriza(loan, { ...firm, legalName: null }, settings, reportDate);
    expect(p.firm.arizaName).toBe('BRIGHT FUTURE FINANCING');
  });

  it('never prints the literal "null" for a missing rate', () => {
    const p = loanToAriza({ ...loan, rate: null }, firm, settings, reportDate);
    expect(p.interestRate).toBe(''); // blank → "yillik % ..." not "yillik null%"
  });

  it('keeps a null contract date as null (ariza drops the -yildagi prefix)', () => {
    const p = loanToAriza({ ...loan, dateToCr: null }, firm, settings, reportDate);
    expect(p.contracts).toEqual([{ number: '22548', date: null }]);
  });
});
