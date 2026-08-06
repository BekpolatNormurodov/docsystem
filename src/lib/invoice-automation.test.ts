import { describe, it, expect, vi } from 'vitest';
import { fillInvoiceForm, type FillablePage } from './invoice-automation';
import type { InvoiceFormData } from '@/core/invoice-fields';

function makePage() {
  const calls: string[] = [];
  const locator = (id: string) => ({
    click: vi.fn(async () => { calls.push(`click:${id}`); }),
    fill: vi.fn(async (v: string) => { calls.push(`fill:${id}=${v}`); }),
    selectByText: vi.fn(async (t: string) => { calls.push(`select:${id}=${t}`); }),
  });
  const page: FillablePage = {
    getByPlaceholder: (t: string) => locator(`ph:${t}`),
    getByText: (t: string) => locator(`text:${t}`),
    getByRole: (r: string, o?: { name?: string }) => locator(`role:${r}:${o?.name ?? ''}`),
  } as any;
  return { page, calls };
}

const data: InvoiceFormData = {
  orgName: 'bright future', stir: '311976765', region: 'Тошкент шаҳар',
  district: 'Олмазор тумани', addressLine: "Sag'bon 7/1",
  courtType: 'Фуқаролик ишлари бўйича', courtRegion: 'Тошкент шаҳар',
  court: 'Фуқаролик ишлари бўйича Учтепа туманлараро суди',
  paymentType: 'Почта харажатлари', amount: 20600,
};

describe('fillInvoiceForm', () => {
  it('fills org name, stir and amount', async () => {
    const { page, calls } = makePage();
    await fillInvoiceForm(page, data);
    expect(calls).toContain('fill:ph:Tashkilot nomi=bright future');
    expect(calls).toContain('fill:ph:STIR=311976765');
    expect(calls.some((c) => c.includes('20600'))).toBe(true);
  });

  it('NEVER touches the captcha or submit', async () => {
    const { page, calls } = makePage();
    await fillInvoiceForm(page, data);
    expect(calls.some((c) => /Robot emasman/i.test(c))).toBe(false);
    expect(calls.some((c) => /Yaratish/i.test(c))).toBe(false);
  });
});
