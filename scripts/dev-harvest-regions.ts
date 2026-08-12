/**
 * Harvests billing.sud.uz address-modal Viloyat -> Tuman (exact Cyrillic) into
 * src/core/billing-regions-data.ts. No captcha — only reads dropdowns.
 * npx tsx scripts/dev-harvest-regions.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright';

async function readOptions(page: Page): Promise<string[]> {
  await page.locator('mat-option, [role="option"]').first().waitFor({ state: 'visible', timeout: 12_000 });
  // FAQAT hozir ochiq (ko'rinadigan) paneldan o'qiymiz — eski/yopiq panellar aralashib ketmasin.
  return page.evaluate(`(function () {
    var panels = document.querySelectorAll('.cdk-overlay-pane [role="listbox"], .mat-mdc-select-panel, [role="listbox"]');
    var panel = null;
    for (var i = 0; i < panels.length; i++) {
      var r = panels[i].getBoundingClientRect();
      if (r.width > 0 && r.height > 0) { panel = panels[i]; break; }
    }
    if (!panel) return [];
    return Array.prototype.map.call(panel.querySelectorAll('mat-option,[role="option"]'), function (o) { return (o.textContent || '').trim(); }).filter(Boolean);
  })()`) as Promise<string[]>;
}

async function main() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  let navOk = false;
  for (let a = 1; a <= 4 && !navOk; a++) {
    try {
      await page.goto('https://billing.sud.uz/create-receipt', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      navOk = true;
    } catch (e) {
      console.log(`nav ${a} failed: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
      await page.waitForTimeout(3000);
    }
  }
  if (!navOk) { console.log('NAV-FAILED'); await browser.close(); return; }
  await page.waitForTimeout(1200);

  await page.getByText('Yuridik shaxs', { exact: false }).click();
  await page.locator('mat-form-field:has(input[formcontrolname="address"])').click();
  const dialog = page.locator('mat-dialog-container');
  await dialog.waitFor();

  const viloyatSel = dialog.locator('mat-select').nth(0);
  await viloyatSel.click();
  const viloyats = await readOptions(page);
  console.log('viloyats:', viloyats.length);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  const map: Record<string, string[]> = {};
  for (const v of viloyats) {
    try {
      await viloyatSel.click();
      await page.getByRole('option', { name: v, exact: true }).click();
      await page.waitForTimeout(700);
      const tumanSel = dialog.locator('mat-select').nth(1);
      await tumanSel.click();
      const tumans = await readOptions(page);
      map[v] = tumans;
      console.log(`  ${v}: ${tumans.length}`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
    } catch (e) {
      console.log(`  ${v}: ERR ${e instanceof Error ? e.message.split('\n')[0] : e}`);
      map[v] = [];
    }
  }

  const out = path.join(process.cwd(), 'src', 'core', 'billing-regions-data.ts');
  const body =
    `// Auto-harvested from billing.sud.uz address modal (Viloyat -> Tuman, exact Cyrillic).\n` +
    `// Regenerate: npx tsx scripts/dev-harvest-regions.ts\n` +
    `export const BILLING_REGIONS: Record<string, string[]> = ${JSON.stringify(map, null, 2)};\n\n` +
    `export const BILLING_VILOYATS: string[] = Object.keys(BILLING_REGIONS);\n`;
  fs.writeFileSync(out, body);
  console.log('WROTE', out, Object.keys(map).length, 'viloyat');
  await browser.close();
  console.log('DONE');
}
main().catch((e) => { console.error(e); process.exit(1); });
