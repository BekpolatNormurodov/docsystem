import fs from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from 'playwright';
import { prisma } from '@/lib/db';
import { buildInvoiceForm, type InvoiceFormData } from '@/core/invoice-fields';

const BILLING_CREATE = 'https://billing.sud.uz/create-receipt';
const STORAGE_DIR = path.join(process.cwd(), 'storage', 'invoices');

/**
 * Angular Material mat-select: combobox'ni bosib ochadi, so'ng cdk overlay'dagi
 * variant matnini (role="option", to'liq moslik) bosadi. Options body'ga qo'shilgani
 * uchun option'ni `page` dan qidiramiz, control'ni esa berilgan locator bo'yicha.
 */
async function selectOption(page: Page, control: Locator, optionText: string) {
  await control.click();
  await page.getByRole('option', { name: optionText, exact: true }).click();
}

/**
 * Billing «create-receipt» formasini to'ldiradi — «Yuridik shaxs» yo'nalishi.
 * Sayt Angular Material — barqaror `formcontrolname` selektorlari ishlatiladi
 * (jonli DOM'dan tasdiqlangan). Manzil «address» maydoni yashirin: uni o'rab turgan
 * mat-form-field bosilsa modal ochiladi (Viloyat/Tuman mat-select'lari + «street»).
 * MUHIM: captcha honeypot maydoni va «Yaratish» tugmasiga TEGMAYDI — foydalanuvchi bosadi.
 */
export async function fillInvoiceForm(page: Page, d: InvoiceFormData): Promise<void> {
  await page.getByText('Yuridik shaxs', { exact: false }).click();
  await page.locator('input[formcontrolname="organizationName"]').fill(d.orgName);
  // STIR maydoni <input type="number"> — probel/format bo'lmasligi shart, faqat raqam.
  await page.locator('input[formcontrolname="INN"]').fill(d.stir.replace(/\D/g, ''));

  // Manzil modal: yashirin «address» inputining mat-form-field'ini bosib ochamiz.
  await page.locator('mat-form-field:has(input[formcontrolname="address"])').click();
  const dialog = page.locator('mat-dialog-container');
  await dialog.waitFor();
  // Modaldagi ikkita mat-select formcontrolname'siz — tartib bo'yicha: 0=Viloyat, 1=Tuman.
  await selectOption(page, dialog.locator('mat-select').nth(0), d.region);
  await selectOption(page, dialog.locator('mat-select').nth(1), d.district);
  // Ko'cha — modaldagi yagona matn input (uning name="street", formcontrolname emas).
  await dialog.getByRole('textbox').fill(d.addressLine);
  await dialog.getByRole('button', { name: 'Saqlash' }).click();

  // Sud kaskadi (turi → hududi → sud) + to'lov turi. «region» = Sud hududi formcontrolname.
  await selectOption(page, page.locator('mat-select[formcontrolname="courtType"]'), d.courtType);
  await selectOption(page, page.locator('mat-select[formcontrolname="region"]'), d.courtRegion);
  await selectOption(page, page.locator('mat-select[formcontrolname="court"]'), d.court);
  await selectOption(page, page.locator('mat-select[formcontrolname="paymentType"]'), d.paymentType);
  await page.locator('input[formcontrolname="paymentAmount"]').fill(String(d.amount));
  // STOP: captcha honeypot + «Yaratish» — qo'lda.
}

export interface TabState {
  index: number;
  status: 'FILLING' | 'WAITING_HUMAN' | 'SUBMITTED' | 'CAPTURED' | 'FAILED';
  invoiceNo?: string;
  message?: string;
}
interface Batch {
  id: string;
  tabs: TabState[];
  firmId: number;
  data: InvoiceFormData;
}

const g = globalThis as unknown as { __invoiceBatches?: Map<string, Batch> };
const batches = g.__invoiceBatches ?? new Map<string, Batch>();
g.__invoiceBatches = batches;

let seq = 0;
function newId(): string {
  seq += 1;
  return `b${Date.now().toString(36)}_${seq}`;
}

export interface StartInput { firmId: number; count: number; paymentType: string; amount: number; }

/** Headed Chromium ochadi, `count` tab, har birini captcha'gacha to'ldiradi, so'ng URL kuzatadi. */
export async function startBatch(input: StartInput): Promise<{ batchId: string; tabs: number }> {
  const firm = await prisma.firm.findUnique({ where: { id: input.firmId } });
  if (!firm) throw new Error('Firma topilmadi');
  if (!firm.region || !firm.district || !firm.addressLine) {
    throw new Error('Firma manzili toʻldirilmagan — «Firmalar» boʻlimida bu firmaga Viloyat, Tuman va koʻcha kiriting.');
  }
  const data = buildInvoiceForm(firm, { paymentType: input.paymentType, amount: input.amount });

  const id = newId();
  const tabs: TabState[] = Array.from({ length: input.count }, (_, i) => ({ index: i, status: 'FILLING' }));
  batches.set(id, { id, tabs, firmId: input.firmId, data });

  // chromium'ni dinamik import qilamiz — modul yuklanishida server'ni bloklamaslik uchun.
  const { chromium } = await import('playwright');
  fs.mkdirSync(STORAGE_DIR, { recursive: true });

  void (async () => {
    let browser;
    try {
      browser = await chromium.launch({ headless: false });
    } catch (e) {
      for (const t of tabs) { t.status = 'FAILED'; t.message = 'Chrome ochilmadi — `npx playwright install chromium` ishga tushiring'; }
      return;
    }
    const ctx = await browser.newContext({ acceptDownloads: true });
    await Promise.all(
      tabs.map(async (t) => {
        try {
          const page = await ctx.newPage();
          await page.goto(BILLING_CREATE, { waitUntil: 'domcontentloaded' });
          await fillInvoiceForm(page, data);
          t.status = 'WAITING_HUMAN';
          // Foydalanuvchi captcha+Yaratish bosishini kutamiz: URL /invoice/{no} ga o'tsa — natija.
          await page.waitForURL(/\/invoice\/\d+/, { timeout: 15 * 60 * 1000 });
          t.status = 'SUBMITTED';
          const m = page.url().match(/\/invoice\/(\d+)/);
          const invoiceNo = m?.[1] ?? '';
          t.invoiceNo = invoiceNo;
          const pdfPath = await capturePdf(ctx, page, invoiceNo);
          await saveRecord(id, invoiceNo, pdfPath);
          t.status = 'CAPTURED';
        } catch (e) {
          t.status = 'FAILED';
          t.message = e instanceof Error ? e.message : 'Xatolik';
        }
      }),
    );
    // Barcha tablar tugagach brauzerni yopmaymiz — foydalanuvchi ko'rib turishi mumkin; keyingi batch yangi brauzer ochadi.
  })();

  return { batchId: id, tabs: input.count };
}

/**
 * Invoice sahifasidagi «...-kvitansiya.pdf» havolasini bosib PDF'ni STORAGE_DIR'ga saqlaydi.
 * Billing PDF'ni ba'zan to'g'ridan-to'g'ri download hodisasi bilan, ba'zan yangi tabda blob:
 * URL sifatida ochadi — ikkala holni ham ushlaymiz. Topolmasa null (raqam baribir saqlanadi).
 */
async function capturePdf(ctx: any, page: any, invoiceNo: string): Promise<string | null> {
  const rel = path.join('storage', 'invoices', `${invoiceNo}.pdf`);
  const abs = path.join(process.cwd(), rel);
  try {
    const link = page.getByText('kvitansiya.pdf', { exact: false }).first();
    await link.waitFor({ timeout: 30_000 });

    // Bosishdan oldin ikkala kutgichni tayyorlaymiz: download hodisasi va yangi tab (popup).
    const downloadP = page.waitForEvent('download', { timeout: 15_000 }).catch(() => null);
    const popupP = ctx.waitForEvent('page', { timeout: 15_000 }).catch(() => null);
    await link.click();

    const download = await downloadP;
    if (download) {
      await download.saveAs(abs);
      return rel;
    }

    // Yangi tabda blob: PDF ochilgan bo'lsa — o'sha sahifa ichida blob'ni o'qib, base64 saqlaymiz.
    const popup = await popupP;
    if (popup) {
      await popup.waitForLoadState('domcontentloaded').catch(() => {});
      const b64: string = await popup.evaluate(`(async function () {
        const r = await fetch(location.href);
        const buf = await r.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let s = '';
        for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
        return btoa(s);
      })()`);
      fs.writeFileSync(abs, Buffer.from(b64, 'base64'));
      await popup.close().catch(() => {});
      return rel;
    }
    return null;
  } catch {
    return null;
  }
}

async function saveRecord(batchId: string, invoiceNo: string, pdfPath: string | null) {
  const b = batches.get(batchId);
  if (!b || !invoiceNo) return;
  await prisma.invoiceRecord.upsert({
    where: { invoiceNo },
    update: { pdfPath: pdfPath ?? undefined },
    create: {
      invoiceNo, firmId: b.firmId, paymentType: b.data.paymentType,
      amount: b.data.amount, courtType: b.data.courtType,
      courtRegion: b.data.courtRegion, court: b.data.court,
      pdfPath: pdfPath ?? undefined, status: 'CREATED',
    },
  });
}

export interface BatchStatus { tabs: TabState[]; }
export function getBatch(batchId: string): BatchStatus | null {
  const b = batches.get(batchId);
  return b ? { tabs: b.tabs } : null;
}
