/**
 * Verifies the harvested BILLING_REGIONS against the LIVE billing modal for a few sample
 * viloyats: selects each, reads its tumans, and compares to our data file exactly.
 * npx tsx scripts/dev-verify-regions.ts
 */
import { chromium, type Page } from 'playwright';
import { BILLING_REGIONS } from '../src/core/billing-regions-data';

const SAMPLES = ['Тошкент шаҳар', 'Фарғона вилояти', 'Қашқадарё вилояти'];

async function readOpenPanel(page: Page): Promise<string[]> {
  await page.locator('mat-option, [role="option"]').first().waitFor({ state: 'visible', timeout: 12_000 });
  return page.evaluate(`(function () {
    var panels = document.querySelectorAll('.cdk-overlay-pane [role="listbox"], .mat-mdc-select-panel, [role="listbox"]');
    var panel = null;
    for (var i = 0; i < panels.length; i++) { var r = panels[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0) { panel = panels[i]; break; } }
    if (!panel) return [];
    return Array.prototype.map.call(panel.querySelectorAll('mat-option,[role="option"]'), function (o) { return (o.textContent || '').trim(); }).filter(Boolean);
  })()`) as Promise<string[]>;
}

async function main() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto('https://billing.sud.uz/create-receipt', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(1200);
  await page.getByText('Yuridik shaxs', { exact: false }).click();
  await page.locator('mat-form-field:has(input[formcontrolname="address"])').click();
  const dialog = page.locator('mat-dialog-container');
  await dialog.waitFor();
  const viloyatSel = dialog.locator('mat-select').nth(0);

  let allOk = true;
  for (const v of SAMPLES) {
    await viloyatSel.click();
    await page.getByRole('option', { name: v, exact: true }).click();
    await page.waitForTimeout(700);
    await dialog.locator('mat-select').nth(1).click();
    const live = await readOpenPanel(page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    const ours = BILLING_REGIONS[v] ?? [];
    const same = live.length === ours.length && live.every((t, i) => t === ours[i]);
    if (!same) allOk = false;
    console.log(`${same ? 'MATCH' : 'MISMATCH'}  ${v}: live=${live.length} ours=${ours.length}`);
    if (!same) {
      console.log('  live :', JSON.stringify(live));
      console.log('  ours :', JSON.stringify(ours));
    }
  }
  console.log(allOk ? 'ALL-MATCH' : 'SOME-MISMATCH');
  await browser.close();
  console.log('DONE');
}
main().catch((e) => { console.error(e); process.exit(1); });
