/**
 * End-to-end single-tab test of the invoice flow, with progress logging.
 * Fills the form, then WAITS for you to click «Robot emasman» + «Yaratish»,
 * then captures the PDF + invoice number and saves an InvoiceRecord.
 * Run: npx tsx scripts/dev-invoice-e2e.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { prisma } from '../src/lib/db';
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
  const firm = await prisma.firm.findFirst({ orderBy: { id: 'asc' } });
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  console.log('STEP goto');
  await page.goto('https://billing.sud.uz/create-receipt', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  console.log('STEP fill');
  await fillInvoiceForm(page, data);
  console.log('WAITING_HUMAN: forma to‘ldirildi — endi «Robot emasman» + «Yaratish» ni BOSING...');

  await page.waitForURL(/\/invoice\/\d+/, { timeout: 15 * 60 * 1000 });
  const invoiceNo = (page.url().match(/\/invoice\/(\d+)/) || [])[1] || '';
  console.log('SUBMITTED: invoice raqami =', invoiceNo);

  // PDF capture (download event OR blob popup)
  const rel = path.join('storage', 'invoices', `${invoiceNo}.pdf`);
  const abs = path.join(process.cwd(), rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  let pdfPath: string | null = null;
  // 1) REST — raqam bo'yicha to'g'ridan-to'g'ri PDF (captcha'siz — hujjat allaqachon bor).
  try {
    const resp = await page.request.get(`https://billing.sud.uz/api/invoice/asDocument?invoice=${invoiceNo}`, { timeout: 30_000 });
    if (resp.ok() && (resp.headers()['content-type'] || '').includes('pdf')) {
      const buf = await resp.body();
      if (buf.length > 0) { fs.writeFileSync(abs, buf); pdfPath = rel; console.log('PDF via REST asDocument, bytes=', buf.length); }
    }
  } catch (e) { console.log('REST pdf note:', e instanceof Error ? e.message.split('\n')[0] : e); }

  if (!pdfPath) try {
    const link = page.getByText('kvitansiya.pdf', { exact: false }).first();
    await link.waitFor({ timeout: 30_000 });
    const downloadP = page.waitForEvent('download', { timeout: 15_000 }).catch(() => null);
    const popupP = ctx.waitForEvent('page', { timeout: 15_000 }).catch(() => null);
    await link.click();
    const download = await downloadP;
    if (download) { await download.saveAs(abs); pdfPath = rel; console.log('PDF via download event'); }
    else {
      const popup = await popupP;
      if (popup) {
        await popup.waitForLoadState('domcontentloaded').catch(() => {});
        const b64: string = await popup.evaluate(`(async function () {
          const r = await fetch(location.href); const buf = await r.arrayBuffer();
          const b = new Uint8Array(buf); let s = '';
          for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
          return btoa(s);
        })()`);
        fs.writeFileSync(abs, Buffer.from(b64, 'base64'));
        pdfPath = rel; console.log('PDF via blob popup, bytes=', fs.statSync(abs).size);
        await popup.close().catch(() => {});
      }
    }
  } catch (e) {
    console.log('PDF capture FAILED:', e instanceof Error ? e.message.split('\n')[0] : e);
  }

  if (firm && invoiceNo) {
    await prisma.invoiceRecord.upsert({
      where: { invoiceNo },
      update: { pdfPath: pdfPath ?? undefined },
      create: {
        invoiceNo, firmId: firm.id, paymentType: data.paymentType, amount: data.amount,
        courtType: data.courtType, courtRegion: data.courtRegion, court: data.court,
        pdfPath: pdfPath ?? undefined, status: 'CREATED',
      },
    });
    console.log('DB: InvoiceRecord saqlandi (firmId=' + firm.id + ', pdf=' + (pdfPath ?? 'yoq') + ')');
  }
  console.log('CAPTURED-DONE');
  await browser.close();
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
