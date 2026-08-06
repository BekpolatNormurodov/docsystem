import { describe, it, expect } from 'vitest';
import { buildInvoiceForm, INVOICE_DEFAULTS, PAYMENT_TYPES } from './invoice-fields';

const firm = {
  id: 1, code: '1', shortName: 'bright future', legalName: null,
  address: null, region: 'Тошкент шаҳар', district: 'Олмазор тумани',
  addressLine: "Sag'bon 7/1", bankAccount: null, mfo: null, stir: '311976765',
  postIndex: null, phone: null, region_: null,
} as any;

describe('buildInvoiceForm', () => {
  it('maps firm fields and applies selections', () => {
    const f = buildInvoiceForm(firm, { paymentType: 'Почта харажатлари', amount: 20600 });
    expect(f.orgName).toBe('bright future');
    expect(f.stir).toBe('311976765');
    expect(f.region).toBe('Тошкент шаҳар');
    expect(f.district).toBe('Олмазор тумани');
    expect(f.amount).toBe(20600);
    expect(f.paymentType).toBe('Почта харажатлари');
    expect(f.courtType).toBe(INVOICE_DEFAULTS.courtType);
    expect(f.court).toBe(INVOICE_DEFAULTS.court);
  });

  it('falls back to legalName when shortName missing', () => {
    const f = buildInvoiceForm({ ...firm, shortName: '', legalName: 'BRIGHT FUTURE LLC' },
      { paymentType: 'Давлат божи', amount: 5000 });
    expect(f.orgName).toBe('BRIGHT FUTURE LLC');
  });

  it('exposes three payment types', () => {
    expect(PAYMENT_TYPES.map((p) => p.value)).toEqual([
      'Давлат божи', 'Почта харажатлари', 'Видеоконференцалоқа харажатлари',
    ]);
  });
});
