/**
 * Live locator check for the invoice module. Opens a HEADED Chrome on billing.sud.uz,
 * fills the create-receipt form up to (and NOT including) the «Robot emasman» captcha,
 * then leaves the window open so you can eyeball it. Never submits, never touches captcha.
 *
 * Run:  npx tsx scripts/dev-invoice-fill.ts
 */
import { chromium } from 'playwright';
import { fillInvoiceForm } from '../src/lib/invoice-automation';
import type { InvoiceFormData } from '../src/core/invoice-fields';

const data: InvoiceFormData = {
  orgName: 'bright future',
  stir: '311976765',
  region: 'Тошкент шаҳар',
  district: 'Олмазор тумани',
  addressLine: "Gurushariq MFY, Sag'bon kochasi 30-berk 7/1",
  courtType: 'Фуқаролик ишлари бўйича суд',
  courtRegion: 'Тошкент шаҳар',
  court: 'Фуқаролик ишлари бўйича Учтепа туманлараро суди',
  paymentType: 'Почта харажатлари',
  amount: 20600,
};

async function main() {
  const browser = await chromium.launch({ headless: false, slowMo: 250 });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('https://billing.sud.uz/create-receipt', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  try {
    await fillInvoiceForm(page, data);
    console.log('FILL-OK: form filled up to amount; captcha/submit left for the human.');
  } catch (e) {
    console.log('FILL-FAILED at some step:', e instanceof Error ? e.message : e);
  }
  // Leave the window open for inspection; close it manually.
  await page.waitForTimeout(10 * 60 * 1000);
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
