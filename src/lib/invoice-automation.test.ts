import { describe, it, expect } from 'vitest';
import { fillInvoiceForm } from './invoice-automation';
import type { InvoiceFormData } from '@/core/invoice-fields';

/**
 * A recording Proxy that stands in for a Playwright Page/Locator. Every method call is
 * logged with its stringified args; locator-returning methods return the proxy again so
 * arbitrary chaining works (`page.locator(..).nth(0).click()`), while click/fill/waitFor
 * resolve. This lets us assert exactly which selectors/roles the driver touches — in
 * particular that it NEVER references the «Yaratish» submit or the captcha honeypot.
 */
// Terminal (promise-returning) Playwright methods; everything else is chainable.
const TERMINAL = new Set([
  'click', 'fill', 'waitFor', 'press', 'goto', 'bringToFront',
  'waitForURL', 'waitForTimeout', 'evaluate', 'saveAs', 'waitForLoadState',
]);

function node(log: string[], name: string): any {
  const fn = (...args: any[]) => {
    log.push(`${name}(${args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(',')})`);
    return TERMINAL.has(name) ? Promise.resolve('') : proxy;
  };
  const proxy: any = new Proxy(fn, {
    get(t, prop) {
      if (prop === 'then') return undefined;
      if (typeof prop === 'symbol') return Reflect.get(t, prop);
      return node(log, String(prop));
    },
    apply(_t, _this, args) {
      return fn(...args);
    },
  });
  return proxy;
}

function makeRecorder() {
  const log: string[] = [];
  return { page: node(log, 'page'), log };
}

const data: InvoiceFormData = {
  orgName: 'bright future', stir: '311976765', region: 'Тошкент шаҳар',
  district: 'Олмазор тумани', addressLine: "Sag'bon 7/1",
  courtType: 'Фуқаролик ишлари бўйича', courtRegion: 'Тошкент шаҳар',
  court: 'Фуқаролик ишлари бўйича Учтепа туманлараро суди',
  paymentType: 'Почта харажатлари', amount: 20600,
};

describe('fillInvoiceForm', () => {
  it('fills org name, STIR, address and amount via formcontrolname selectors', async () => {
    const { page, log } = makeRecorder();
    await fillInvoiceForm(page, data);
    const joined = log.join('\n');
    expect(joined).toContain('input[formcontrolname="organizationName"]');
    expect(joined).toContain('bright future');
    expect(joined).toContain('input[formcontrolname="INN"]');
    expect(joined).toContain('input[formcontrolname="paymentAmount"]');
    // Address street is the modal's sole textbox; addressLine is filled somewhere.
    expect(joined).toContain("Sag'bon 7/1");
    expect(joined).toContain('20600');
    // Court cascade + payment type option picks happen.
    expect(joined).toContain('mat-select[formcontrolname="courtType"]');
  });

  it('NEVER touches the captcha honeypot or the Yaratish submit button', async () => {
    const { page, log } = makeRecorder();
    await fillInvoiceForm(page, data);
    const joined = log.join('\n');
    expect(/Yaratish/i.test(joined)).toBe(false);
    expect(/captcha/i.test(joined)).toBe(false);
    expect(/Robot emasman/i.test(joined)).toBe(false);
  });
});
