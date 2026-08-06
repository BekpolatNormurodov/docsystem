import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '@/lib/db';
import { buildInvoiceForm, type InvoiceFormData } from '@/core/invoice-fields';

const BILLING_CREATE = 'https://billing.sud.uz/create-receipt';
const STORAGE_DIR = path.join(process.cwd(), 'storage', 'invoices');

/** Minimal yuza — test mock qila oladigan Page abstraksiyasi (Playwright Page shu shaklga mos). */
export interface FillableLocator {
  click(): Promise<void>;
  fill(value: string): Promise<void>;
}
export interface FillablePage {
  getByPlaceholder(text: string): FillableLocator;
  getByText(text: string, opts?: { exact?: boolean }): FillableLocator;
  getByRole(role: string, opts?: { name?: string }): FillableLocator;
}

/** MUI dropdown: control'ni bosib ochadi, keyin variant matnini bosadi. */
async function pickDropdown(page: FillablePage, controlPlaceholder: string, optionText: string) {
  await page.getByPlaceholder(controlPlaceholder).click();
  await page.getByText(optionText, { exact: false }).click();
}

/**
 * Billing «create-receipt» formasini to'ldiradi — «Yuridik shaxs» yo'nalishi.
 * MUHIM: captcha («Robot emasman») va «Yaratish» ga TEGMAYDI — foydalanuvchi bosadi.
 */
export async function fillInvoiceForm(page: FillablePage, d: InvoiceFormData): Promise<void> {
  await page.getByText('Yuridik shaxs', { exact: false }).click();
  await page.getByPlaceholder('Tashkilot nomi').fill(d.orgName);
  await page.getByPlaceholder('STIR').fill(d.stir);

  // Manzil modal: ochish → viloyat/tuman dropdown → ko'cha → Saqlash
  await page.getByPlaceholder('Tashkilot manzili').click();
  await pickDropdown(page, 'Viloyat', d.region);
  await pickDropdown(page, 'Tuman', d.district);
  await page.getByPlaceholder('Manzil').fill(d.addressLine);
  await page.getByRole('button', { name: 'Saqlash' }).click();

  await pickDropdown(page, 'Sud turi', d.courtType);
  await pickDropdown(page, 'Sud hududi', d.courtRegion);
  await pickDropdown(page, 'Sud', d.court);
  await pickDropdown(page, "To'lov turi", d.paymentType);
  await page.getByPlaceholder('Kvitansiya summasi').fill(String(d.amount));
  // STOP: captcha va «Yaratish» — qo'lda.
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
          await fillInvoiceForm(page as unknown as FillablePage, data);
          t.status = 'WAITING_HUMAN';
          // Foydalanuvchi captcha+Yaratish bosishini kutamiz: URL /invoice/{no} ga o'tsa — natija.
          await page.waitForURL(/\/invoice\/\d+/, { timeout: 15 * 60 * 1000 });
          t.status = 'SUBMITTED';
          const m = page.url().match(/\/invoice\/(\d+)/);
          const invoiceNo = m?.[1] ?? '';
          t.invoiceNo = invoiceNo;
          const pdfPath = await capturePdf(page, invoiceNo);
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

/** Invoice sahifasidagi «...-kvitansiya.pdf» havolasini bosib PDF'ni STORAGE_DIR'ga yuklaydi. */
async function capturePdf(page: any, invoiceNo: string): Promise<string | null> {
  try {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60_000 }),
      page.getByText('kvitansiya.pdf', { exact: false }).click(),
    ]);
    const rel = path.join('storage', 'invoices', `${invoiceNo}.pdf`);
    await download.saveAs(path.join(process.cwd(), rel));
    return rel;
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
