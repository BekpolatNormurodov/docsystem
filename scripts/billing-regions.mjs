// billing.sud.uz create-receipt formasidagi Viloyat/Tuman dropdown ma'lumotini
// o'qib, scripts/billing-regions.json ga yozadi. FAQAT O'QISH — kvitansiya YARATMAYDI.
//
// ISHLATISH (o'z terminalingizda, loyiha ildizida — billing.sud.uz sizda ochiladigan tarmoqda):
//   node scripts/billing-regions.mjs
// Tugagach scripts/billing-regions.json faylini menga yuboring.
//
// Talab: playwright + chromium (loyihada bor). Kerak bo'lsa: npx playwright install chromium
import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
import { chromium } from 'playwright';

const OUT = path.join(process.cwd(), 'scripts', 'billing-regions.json');
const captured = [];   // network JSON javoblari (id+nom bo'lsa shu yerdan)
const result = { viloyatlar: [], tumanlar: {}, apiResponses: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: false }); // ko'rish uchun headed; xohlasangiz true
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await ctx.newPage();

// Region/district API javoblarini ushlaymiz — id+nom shu yerda bo'lishi mumkin.
page.on('response', async (res) => {
  try {
    const ct = res.headers()['content-type'] || '';
    if (!ct.includes('json')) return;
    const url = res.url();
    if (/create-receipt/.test(url)) return;
    const body = await res.json().catch(() => null);
    if (!body) return;
    const s = JSON.stringify(body);
    if (/вилоят|тумани|шаҳар|шахар|region|district|province|area/i.test(s)) {
      captured.push({ url, body });
    }
  } catch {}
});

async function readOptions() {
  const opts = page.getByRole('option');
  const cnt = await opts.count();
  const out = [];
  for (let i = 0; i < cnt; i++) out.push((await opts.nth(i).innerText()).trim());
  return out;
}

try {
  console.log('→ billing.sud.uz/create-receipt ochilyapti...');
  await page.goto('https://billing.sud.uz/create-receipt', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(3500);

  try { await page.getByText('Yuridik shaxs', { exact: false }).click({ timeout: 10000 }); } catch {}
  await sleep(1500);
  await page.locator('mat-form-field:has(input[formcontrolname="address"])').click({ timeout: 10000 });
  const dialog = page.locator('mat-dialog-container');
  await dialog.waitFor({ timeout: 10000 });
  await sleep(1000);

  // 1) Viloyatlar ro'yxati
  await dialog.locator('mat-select').nth(0).click({ timeout: 10000 });
  await sleep(1200);
  result.viloyatlar = await readOptions();
  console.log(`✓ Viloyat: ${result.viloyatlar.length} ta`);
  // panelni yopamiz (birinchisini tanlamasdan) — Escape modalni yopmasligi uchun option tanlaymiz keyin
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(600);

  // 2) Har viloyat uchun tumanlar (cascading)
  for (let vi = 0; vi < result.viloyatlar.length; vi++) {
    const vName = result.viloyatlar[vi];
    try {
      await dialog.locator('mat-select').nth(0).click({ timeout: 8000 });
      await sleep(900);
      await page.getByRole('option').nth(vi).click({ timeout: 8000 });
      await sleep(1200);
      await dialog.locator('mat-select').nth(1).click({ timeout: 8000 });
      await sleep(1000);
      const tumans = await readOptions();
      result.tumanlar[vName] = tumans;
      console.log(`  · ${vName}: ${tumans.length} tuman`);
      await page.keyboard.press('Escape').catch(() => {});
      await sleep(500);
    } catch (e) {
      console.log(`  ! ${vName}: xato — ${e.message.split('\n')[0]}`);
      await page.keyboard.press('Escape').catch(() => {});
    }
  }

  result.apiResponses = captured;
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');
  console.log(`\n✅ Saqlandi: ${OUT}`);
  console.log(`   Viloyat: ${result.viloyatlar.length}, API javoblari: ${captured.length}`);
} catch (e) {
  console.error('XATO:', e.message);
  // Bor bo'lganini baribir saqlaymiz
  result.apiResponses = captured;
  try { fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8'); console.log('qisman saqlandi:', OUT); } catch {}
} finally {
  await sleep(1000);
  await browser.close();
}
