/**
 * Reproduces the app's multi-tab sequential fill with per-STEP logging + timings,
 * using the real firm DB data (BRIGHT FUTURE id=1). Shows exactly which step stalls.
 * npx tsx scripts/dev-invoice-diagmulti.ts
 */
import { chromium, type Page, type Locator } from 'playwright';
import { prisma } from '../src/lib/db';
import { buildInvoiceForm, type InvoiceFormData } from '../src/core/invoice-fields';

const TABS = 2;
const t0 = Date.now();
const log = (m: string) => console.log(`+${((Date.now() - t0) / 1000).toFixed(1)}s ${m}`);

async function sel(page: Page, control: Locator, text: string, label: string) {
  const opt = page.getByRole('option', { name: text, exact: true });
  for (let a = 1; a <= 3; a++) {
    try {
      await control.click();
      await opt.waitFor({ state: 'visible', timeout: 12_000 });
      await opt.click({ timeout: 8_000 });
      await page.waitForTimeout(600);
      log(`    ${label} OK (attempt ${a})`);
      return;
    } catch (e) {
      log(`    ${label} attempt ${a} FAIL: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
      if (a === 3) throw e;
      await page.waitForTimeout(900);
    }
  }
}

async function fill(page: Page, d: InvoiceFormData, tab: number) {
  log(`[tab ${tab}] yuridik`); await page.getByText('Yuridik shaxs', { exact: false }).click();
  log(`[tab ${tab}] orgName`); await page.locator('input[formcontrolname="organizationName"]').fill(d.orgName);
  log(`[tab ${tab}] INN`); await page.locator('input[formcontrolname="INN"]').fill(d.stir.replace(/\D/g, ''));
  log(`[tab ${tab}] open-modal`); await page.locator('mat-form-field:has(input[formcontrolname="address"])').click();
  const dialog = page.locator('mat-dialog-container'); await dialog.waitFor();
  log(`[tab ${tab}] viloyat`); await sel(page, dialog.locator('mat-select').nth(0), d.region, 'viloyat');
  log(`[tab ${tab}] tuman`); await sel(page, dialog.locator('mat-select').nth(1), d.district, 'tuman');
  log(`[tab ${tab}] street`); await dialog.getByRole('textbox').fill(d.addressLine);
  log(`[tab ${tab}] saqlash`); await dialog.getByRole('button', { name: 'Saqlash' }).click();
  log(`[tab ${tab}] courtType`); await sel(page, page.locator('mat-select[formcontrolname="courtType"]'), d.courtType, 'courtType');
  log(`[tab ${tab}] region`); await sel(page, page.locator('mat-select[formcontrolname="region"]'), d.courtRegion, 'region');
  log(`[tab ${tab}] court`); await sel(page, page.locator('mat-select[formcontrolname="court"]'), d.court, 'court');
  log(`[tab ${tab}] paymentType`); await sel(page, page.locator('mat-select[formcontrolname="paymentType"]'), d.paymentType, 'paymentType');
  log(`[tab ${tab}] amount`); await page.locator('input[formcontrolname="paymentAmount"]').fill(String(d.amount));
  log(`[tab ${tab}] DONE`);
}

async function main() {
  const firm = await prisma.firm.findUnique({ where: { id: 1 } });
  if (!firm) throw new Error('firm 1 yoq');
  const d = buildInvoiceForm(firm, { paymentType: 'Почта харажатлари', amount: 20600 });
  log(`data: reg=${d.region} dist=${d.district} line=${d.addressLine ? 'bor' : 'YOQ'} court=${d.court}`);

  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ acceptDownloads: true });
  const pages: Page[] = [];
  for (let i = 0; i < TABS; i++) {
    const p = await ctx.newPage();
    await p.goto('https://billing.sud.uz/create-receipt', { waitUntil: 'domcontentloaded' });
    pages.push(p);
  }
  log('all tabs opened');

  for (let i = 0; i < TABS; i++) {
    log(`=== bringToFront tab ${i} ===`);
    await pages[i].bringToFront();
    try { await fill(pages[i], d, i); } catch (e) { log(`[tab ${i}] FAILED: ${e instanceof Error ? e.message.split('\n')[0] : e}`); }
  }
  log('ALL-FILLED');
  await prisma.$disconnect();
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
