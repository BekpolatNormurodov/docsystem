// billing.sud.uz kvitansiya (invoice) — sof REST paket rejimi. Brauzer/Playwright
// yo'q: captcha token to'g'ridan-to'g'ri recaptcha.sud.uz/analyze dan olinadi
// (ko'pincha challengeRequired:false), so'ng invoice yaratiladi va PDF yuklanadi.
// Desktopdagi more_invoice.js mantiqidan ko'chirilgan, app fonida ishlaydi.
import fs from 'node:fs';
import path from 'node:path';
import type { Firm } from '@prisma/client';
import { prisma } from '@/lib/db';

const CAPTCHA_API = 'https://recaptcha.sud.uz/api/v1/captcha';
const INVOICE_API = 'https://billing.sud.uz/api/invoice/captcha/create';
const DOCUMENT_API = 'https://billing.sud.uz/api/invoice/asDocument';
const SITE_KEY = 'site_bbdb0625df8a200e73f37ebccf0c62ac';

const STORAGE_DIR = path.join(process.cwd(), 'storage', 'invoices');

// -------------------------------------------------------------
// SOZLAMALAR (more_invoice.js dagidek — IP blok bo'lmasligi uchun)
// -------------------------------------------------------------
const MAX_RETRIES = 4;                 // har bir so'rov uchun maksimal qayta urinish
const DELAY_BETWEEN_REQUESTS = 2500;   // oddiy so'rovlar orasidagi pauza
const BATCH_SIZE = 15;                 // har 15 ta kvitansiyadan keyin katta tanaffus
const BATCH_PAUSE_MS = 15_000;         // katta tanaffus vaqti (15 soniya)
const MAX_CAPTCHA_RETRY = 5;           // challenge kelsa skip qilib qayta analyze urinishlari
const MAX_COUNT = 100;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function safeJson(res: Response): Promise<any> {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { rawText: text.slice(0, 300) }; }
}

// -------------------------------------------------------------
// SAFE FETCH (timeout + 429/403 aniqlash + backoff)
// -------------------------------------------------------------
async function fetchWithRetry(url: string, options: RequestInit = {}, retries = MAX_RETRIES): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20_000);
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Origin: 'https://billing.sud.uz',
          Referer: 'https://billing.sud.uz/',
          'Accept-Language': 'uz,ru;q=0.9,en;q=0.8',
          ...(options.headers as Record<string, string> | undefined),
        },
      });
      clearTimeout(timeoutId);
      return response;
    } catch (err) {
      lastErr = err;
      if (attempt === retries) throw err;
      await sleep(6000 * attempt);
    }
  }
  throw lastErr;
}

// -------------------------------------------------------------
// PAYLOAD — konstanta (skriptdagidek) + firmadan name/tin/address
// -------------------------------------------------------------
export interface RestPayload {
  amount: number;
  captchaToken: string;
  courtId: string;
  courtType: string;
  description: string;
  entityType: string;
  isInFavor: boolean;
  juridicalEntity: { address: string; name: string; tin: string };
  overdue: number;
  payCategoryId: number;
}

export function buildFirmAddress(firm: Pick<Firm, 'region' | 'district' | 'addressLine'>): string {
  return [firm.region, firm.district, firm.addressLine].map((s) => s?.trim()).filter(Boolean).join(', ');
}

export function buildRestPayload(firm: Firm): RestPayload {
  const name = firm.shortName?.trim() || firm.legalName?.trim() || '';
  const tin = (firm.stir ?? '').replace(/\D/g, '');
  const address = buildFirmAddress(firm);
  return {
    amount: 2060000,
    captchaToken: '',
    courtId: '525',
    courtType: 'CITIZEN',
    description: '',
    entityType: 'JURIDICAL',
    isInFavor: true,
    juridicalEntity: { address, name, tin },
    overdue: 0,
    payCategoryId: 3,
  };
}

// -------------------------------------------------------------
// BOSQICH 1: CAPTCHA token — challenge kelsa skip qilib qayta urinish
// -------------------------------------------------------------
export async function getCaptchaToken(): Promise<string> {
  let lastMsg = 'token olinmadi';
  for (let attempt = 1; attempt <= MAX_CAPTCHA_RETRY; attempt++) {
    const res = await fetchWithRetry(`${CAPTCHA_API}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/plain, */*' },
      body: JSON.stringify({ siteKey: SITE_KEY, action: 'create_invoice', timestamp: Date.now(), signals: {} }),
    });
    const data = await safeJson(res);
    if (!res.ok) { lastMsg = `analyze ${res.status}`; await sleep(1500); continue; }
    if (data.challengeRequired === false && data.token) return data.token as string;
    // Challenge talab qilindi — skip qilib qayta urinamiz (odam aralashmaydi).
    lastMsg = 'captcha challenge — skip/retry';
    await sleep(1500);
  }
  throw new Error(lastMsg);
}

// -------------------------------------------------------------
// BOSQICH 2: Kvitansiya yaratish
// -------------------------------------------------------------
export async function createInvoiceRest(token: string, payload: RestPayload): Promise<string> {
  const res = await fetchWithRetry(INVOICE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/plain, */*' },
    body: JSON.stringify({ ...payload, captchaToken: token }),
  });
  const data = await safeJson(res);
  if (!(res.status === 201 || res.ok)) throw new Error(`create ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  const invoiceNo = data.invoice || data.invoiceNumber || data.id || data.code;
  if (!invoiceNo) throw new Error('server javobida invoice raqami yo‘q');
  return String(invoiceNo);
}

// -------------------------------------------------------------
// BOSQICH 3: PDF yuklab olish → storage/invoices/{no}.pdf
// -------------------------------------------------------------
export async function downloadInvoicePdf(invoiceNo: string): Promise<string> {
  const res = await fetchWithRetry(`${DOCUMENT_API}?invoice=${encodeURIComponent(invoiceNo)}`, {
    method: 'GET', headers: { Accept: 'application/pdf, */*' },
  });
  if (!res.ok) throw new Error(`PDF ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.slice(0, 4).toString() !== '%PDF') throw new Error('PDF emas');
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
  const rel = path.join('storage', 'invoices', `${invoiceNo}.pdf`);
  fs.writeFileSync(path.join(process.cwd(), rel), buf);
  return rel;
}

// -------------------------------------------------------------
// FON JARAYON HOLATI (count asosida, jonli progress)
// -------------------------------------------------------------
export type ItemStatus = 'PENDING' | 'OK' | 'FAILED';
export interface BatchItem { index: number; status: ItemStatus; invoiceNo?: string; message?: string; }
export interface BatchProgress {
  total: number;
  done: number;
  ok: number;
  failed: number;
  current: number;             // 1-based, ishlanayotgan invoice tartibi
  phase: 'RUNNING' | 'PAUSING' | 'DONE';
  pauseLeftMs: number;
  items: BatchItem[];
}
interface Batch extends BatchProgress { id: string; firmId: number; }

const g = globalThis as unknown as { __invoiceRestBatches?: Map<string, Batch> };
const batches = g.__invoiceRestBatches ?? new Map<string, Batch>();
g.__invoiceRestBatches = batches;

let seq = 0;
function newId(): string { seq += 1; return `r${Date.now().toString(36)}_${seq}`; }

export function getRestBatch(id: string): BatchProgress | null {
  const b = batches.get(id);
  if (!b) return null;
  const { firmId: _f, id: _i, ...progress } = b;
  return progress;
}

/** batchdagi muvaffaqiyatli invoicelar (ZIP uchun). */
export function getRestBatchPdfs(id: string): { invoiceNo: string }[] {
  const b = batches.get(id);
  if (!b) return [];
  return b.items.filter((it) => it.status === 'OK' && it.invoiceNo).map((it) => ({ invoiceNo: it.invoiceNo! }));
}

async function saveRecord(firmId: number, payload: RestPayload, invoiceNo: string, pdfPath: string | null) {
  await prisma.invoiceRecord.upsert({
    where: { invoiceNo },
    update: { pdfPath: pdfPath ?? undefined },
    create: {
      invoiceNo, firmId, paymentType: 'Почта харажатлари', amount: payload.amount,
      courtType: payload.courtType, courtRegion: '', court: payload.courtId,
      pdfPath: pdfPath ?? undefined, status: 'CREATED',
    },
  });
}

export interface StartRestInput { firmId: number; count: number; }

/** Fon paket jarayonini boshlaydi. Darhol batchId qaytaradi, ishni orqada davom ettiradi. */
export async function startRestBatch(input: StartRestInput): Promise<{ batchId: string; total: number }> {
  const firm = await prisma.firm.findUnique({ where: { id: input.firmId } });
  if (!firm) throw new Error('Firma topilmadi');
  const payload = buildRestPayload(firm);
  if (!payload.juridicalEntity.name) throw new Error('Firma nomi yo‘q');
  if (!payload.juridicalEntity.tin) throw new Error('Firma STIR raqami yo‘q');
  if (!payload.juridicalEntity.address) {
    throw new Error('Firma manzili toʻldirilmagan — «Firmalar» boʻlimida Viloyat, Tuman va koʻcha kiriting.');
  }

  const total = Math.max(1, Math.min(MAX_COUNT, Math.floor(input.count) || 1));
  const id = newId();
  const batch: Batch = {
    id, firmId: input.firmId, total, done: 0, ok: 0, failed: 0, current: 0,
    phase: 'RUNNING', pauseLeftMs: 0,
    items: Array.from({ length: total }, (_, i) => ({ index: i, status: 'PENDING' as ItemStatus })),
  };
  batches.set(id, batch);

  void (async () => {
    for (let i = 1; i <= total; i++) {
      batch.current = i;
      batch.phase = 'RUNNING';
      const item = batch.items[i - 1];
      try {
        const token = await getCaptchaToken();
        const invoiceNo = await createInvoiceRest(token, payload);
        let pdfPath: string | null = null;
        try { pdfPath = await downloadInvoicePdf(invoiceNo); } catch { /* raqam saqlanadi, PDF ixtiyoriy */ }
        await saveRecord(input.firmId, payload, invoiceNo, pdfPath);
        item.status = 'OK'; item.invoiceNo = invoiceNo; batch.ok += 1;
      } catch (e) {
        item.status = 'FAILED'; item.message = e instanceof Error ? e.message : 'Xatolik'; batch.failed += 1;
      }
      batch.done += 1;

      if (i === total) break;
      // Har BATCH_SIZE tadan keyin katta tanaffus, aks holda oddiy pauza.
      if (i % BATCH_SIZE === 0) {
        batch.phase = 'PAUSING';
        const until = Date.now() + BATCH_PAUSE_MS;
        while (Date.now() < until) { batch.pauseLeftMs = until - Date.now(); await sleep(500); }
        batch.pauseLeftMs = 0;
      } else {
        await sleep(DELAY_BETWEEN_REQUESTS);
      }
    }
    batch.phase = 'DONE';
    batch.current = total;
  })();

  return { batchId: id, total };
}
