/**
 * Fill -> you click captcha+Yaratish -> then PAUSE (no download). Prints the created
 * invoice's full data (api/invoice/checkStatus) so you can verify completeness, and
 * keeps the window open for a few minutes for a visual check. npx tsx scripts/dev-invoice-check.ts
 */
import { chromium } from 'playwright';
import { prisma } from '../src/lib/db';
import { fillInvoiceForm } from '../src/lib/invoice-automation';
import { buildInvoiceForm } from '../src/core/invoice-fields';

async function main() {
  const firm = await prisma.firm.findUnique({ where: { id: 1 } });
  if (!firm) throw new Error('firm 1 yoq');
  const data = buildInvoiceForm(firm, { paymentType: 'Почта харажатлари', amount: 20600 });

  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('https://billing.sud.uz/create-receipt', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  console.log('STEP fill');
  await fillInvoiceForm(page, data);
  console.log('WAITING_HUMAN: «Robot emasman» + «Yaratish» ni BOSING...');

  await page.waitForURL(/\/invoice\/\d+/, { timeout: 15 * 60 * 1000 });
  const invoiceNo = (page.url().match(/\/invoice\/(\d+)/) || [])[1] || '';
  console.log('SUBMITTED: invoice raqami =', invoiceNo);

  // Ma'lumotlarni ko'rsatamiz (yuklab OLMAYMIZ) — to'liqligini tekshirish uchun.
  try {
    const resp = await page.request.get(`https://billing.sud.uz/api/invoice/checkStatus?invoice=${invoiceNo}&lang=name`, { timeout: 30_000 });
    if (resp.ok()) {
      const json = await resp.json();
      console.log('=== INVOICE DATA (checkStatus) ===');
      console.log(JSON.stringify(json, null, 2));
    } else {
      console.log('checkStatus status:', resp.status());
    }
  } catch (e) {
    console.log('checkStatus note:', e instanceof Error ? e.message.split('\n')[0] : e);
  }

  console.log('PAUSE: oyna ochiq qoldi (yuklab olinmadi). Ma\'lumotlarni tekshiring — ~10 daqiqa.');
  await page.waitForTimeout(10 * 60 * 1000);
  await browser.close();
  await prisma.$disconnect();
  console.log('DONE');
}
main().catch((e) => { console.error(e); process.exit(1); });
