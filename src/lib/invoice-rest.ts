// billing.sud.uz kvitansiya (invoice) — sof REST paket rejimi. Brauzer/Playwright
// yo'q: captcha token to'g'ridan-to'g'ri recaptcha.sud.uz/analyze dan olinadi
// (ko'pincha challengeRequired:false), so'ng invoice yaratiladi va PDF yuklanadi.
// Desktopdagi more_invoice.js mantiqidan ko'chirilgan, app fonida ishlaydi.
import fs from 'node:fs';
import path from 'node:path';
import type { Firm } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getBojiAmount } from './konveyer-buxgalter';
import { dueForStage } from './konveyer-sla';

const CAPTCHA_API = 'https://recaptcha.sud.uz/api/v1/captcha';
const INVOICE_API = 'https://billing.sud.uz/api/invoice/captcha/create';
const DOCUMENT_API = 'https://billing.sud.uz/api/invoice/asDocument';
const SITE_KEY = 'site_bbdb0625df8a200e73f37ebccf0c62ac';

const STORAGE_DIR = path.join(process.cwd(), 'storage', 'invoices');

// -------------------------------------------------------------
// SOZLAMALAR (more_invoice.js dagidek — IP blok bo'lmasligi uchun)
// -------------------------------------------------------------
const MAX_RETRIES = 4;                 // har bir so'rov uchun maksimal qayta urinish
const DELAY_BETWEEN_REQUESTS = 700;    // guruh ichida ketma-ket so'rovlar orasidagi qisqa pauza
const CONCURRENCY = 3;                  // guruh ichida bir vaqtda nechta kvitansiya (tezlash)
const BATCH_SIZE = 15;                  // har 15 ta kvitansiyadan keyin katta tanaffus
const BATCH_PAUSE_MS = 15_000;          // katta tanaffus vaqti (15 soniya) — IP blok bo'lmasligi uchun
const MAX_CAPTCHA_RETRY = 5;            // challenge kelsa skip qilib qayta analyze urinishlari
const MAX_ITEM_ATTEMPTS = 3;           // bitta kvitansiya uchun tashqi qayta urinish; 3 tada ham bo'lmasa → xato
const ITEM_RETRY_BACKOFF = 2500;       // urinishlar orasidagi kutish (o'sib boradi)
const MAX_COUNT = 100;
// Bazadan tiklaganda: non-terminal (RUNNING/PAUSING) batch shu vaqtdan ko'p tegilmagan
// bo'lsa (server qayta ishga tushgan, fon jarayon o'lgan) — BLOCKED deb ko'rsatamiz,
// aks holda UI cheksiz poll qiladi. Item timeout (3×20s) + pauza (15s)dan katta.
const STALE_MS = 90_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Xato IP blok/tarmoq (qayta urinishga arziydi, «IP bloklandi» deb ko'rsatiladi) mi,
 * yoki deterministik server rad etishi (400/404/422, «invoice raqami yo'q») mi.
 * Har ikkalasi ham paketni to'xtatadi (foydalanuvchi «98 berma» dedi), lekin xabar aniq bo'ladi.
 */
function isBlockError(msg: string): boolean {
  return /\b(429|403|5\d\d)\b|timeout|timed?\s*out|abort|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|network|fetch failed|captcha|challenge|analyze|token olinmadi/i.test(msg);
}

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

// Summa har doim chaqiruvchidan (getBojiAmount — davlat boji, default 20 600) keladi;
// bu yerda default yo'q — noto'g'ri summa (masalan eski 2 060 000) tasodifan ketmasin.
export function buildRestPayload(firm: Firm, opts: { amount: number }): RestPayload {
  const name = firm.shortName?.trim() || firm.legalName?.trim() || '';
  const tin = (firm.stir ?? '').replace(/\D/g, '');
  const address = buildFirmAddress(firm);
  return {
    amount: opts.amount,
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
  phase: 'RUNNING' | 'PAUSING' | 'DONE' | 'BLOCKED';
  pauseLeftMs: number;
  items: BatchItem[];
  error?: string;              // BLOCKED bo'lganda: IP blok/tarmoq xabari
}
interface Batch extends BatchProgress { id: string; firmId: number; amount: number; aborted?: boolean }

const g = globalThis as unknown as { __invoiceRestBatches?: Map<string, Batch> };
const batches = g.__invoiceRestBatches ?? new Map<string, Batch>();
g.__invoiceRestBatches = batches;

let seq = 0;
function newId(): string { seq += 1; return `r${Date.now().toString(36)}_${seq}`; }

/** «Bekor qilish» — mark a live (in-memory) batch as aborted. The runner stops at its next check and
 *  finalizes (DONE) with whatever it produced so far. Returns false if the batch isn't in memory
 *  (server restarted → it's already shown as BLOCKED, nothing to stop). */
export function abortRestBatch(id: string): boolean {
  const b = batches.get(id);
  if (!b) return false;
  b.aborted = true;
  return true;
}

export async function getRestBatch(id: string): Promise<BatchProgress | null> {
  const b = batches.get(id);
  if (b) {
    const { firmId: _f, id: _i, aborted: _a, ...progress } = b;
    return progress;
  }
  // Xotirada yo'q (server qayta ishga tushgan) — bazadan tiklaymiz.
  const row = await prisma.invoiceRestBatch.findUnique({
    where: { id },
    include: { records: { select: { invoiceNo: true, pdfPath: true, status: true }, orderBy: { id: 'asc' } } },
  });
  if (!row) return null;
  const done = row.ok + row.failed;
  // Fon jarayon in-process ishlaydi; server qayta ishga tushsa DB non-terminal fazada
  // qotib qoladi. updatedAt eskirgan bo'lsa — jarayon o'lgan, BLOCKED deb ko'rsatamiz.
  const rawPhase = (row.phase as BatchProgress['phase']) ?? 'DONE';
  const stale = Date.now() - new Date(row.updatedAt).getTime() > STALE_MS;
  const phase: BatchProgress['phase'] =
    (rawPhase === 'RUNNING' || rawPhase === 'PAUSING') && stale ? 'BLOCKED' : rawPhase;
  // items[] ni to'liq total uzunlikda tiklaymiz: saqlangan yozuvlar (OK/FAILED),
  // qolgan indekslar PENDING. FAILED yozuvlar hozircha saqlanmaydi, shuning uchun
  // ro'yxat asosan OK; lekin uzunlik total bilan mos bo'ladi.
  const items: BatchItem[] = Array.from({ length: row.total }, (_, i) => {
    const r = row.records[i];
    return r
      ? { index: i, status: (r.status === 'FAILED' ? 'FAILED' : 'OK') as ItemStatus, invoiceNo: r.invoiceNo }
      : { index: i, status: 'PENDING' as ItemStatus };
  });
  return {
    total: row.total, done, ok: row.ok, failed: row.failed,
    current: phase === 'DONE' ? row.total : done, phase, pauseLeftMs: 0, items,
    ...(phase === 'BLOCKED'
      ? { error: stale && rawPhase !== 'BLOCKED'
          ? 'Jarayon uzildi (server qayta ishga tushgan) — yaratilganlarini yuklab olishingiz mumkin.'
          : 'IP bloklandi yoki tarmoq ishlamayapti — 3 marta urinildi.' }
      : {}),
  };
}

/** Firma uchun hozir ishlayotgan (RUNNING/PAUSING) paket bormi — takroriy start'ni bloklash uchun. */
function hasActiveBatchForFirm(firmId: number): boolean {
  for (const b of batches.values()) {
    if (b.firmId === firmId && (b.phase === 'RUNNING' || b.phase === 'PAUSING')) return true;
  }
  return false;
}

/** batchdagi muvaffaqiyatli (PDF'li) invoicelar (ZIP uchun) — xotira yoki bazadan. */
export async function getRestBatchPdfs(id: string): Promise<{ invoiceNo: string }[]> {
  const b = batches.get(id);
  if (b) return b.items.filter((it) => it.status === 'OK' && it.invoiceNo).map((it) => ({ invoiceNo: it.invoiceNo! }));
  const rows = await prisma.invoiceRecord.findMany({
    where: { restBatchId: id, pdfPath: { not: null } }, select: { invoiceNo: true },
  });
  return rows.map((r) => ({ invoiceNo: r.invoiceNo }));
}

export interface ReportRow {
  tr: number; invoiceNo: string; firmName: string; stir: string;
  amount: number; pdf: string; status: string;
}
/** Excel hisobot uchun barcha qatorlar (OK + xato) — xotira yoki bazadan. */
export async function getRestBatchReport(id: string): Promise<{ firmName: string; rows: ReportRow[] } | null> {
  const b = batches.get(id);
  if (b) {
    const firm = await prisma.firm.findUnique({ where: { id: b.firmId } });
    const name = firm?.shortName?.trim() || firm?.legalName?.trim() || '';
    const stir = (firm?.stir ?? '').replace(/\D/g, '');
    const rows: ReportRow[] = b.items.map((it, i) => ({
      tr: i + 1,
      invoiceNo: it.invoiceNo || '-',
      firmName: name,
      stir,
      amount: b.amount,
      pdf: it.status === 'OK' && it.invoiceNo ? `${it.invoiceNo}.pdf` : '-',
      status: it.status === 'OK' ? 'Muvaffaqiyatli' : it.status === 'FAILED' ? `Xatolik: ${it.message ?? ''}` : 'Kutilmoqda',
    }));
    return { firmName: name, rows };
  }
  // Xotirada yo'q — bazadan (faqat saqlangan yozuvlar).
  const recs = await prisma.invoiceRecord.findMany({
    where: { restBatchId: id }, orderBy: { id: 'asc' },
    include: { firm: { select: { shortName: true, legalName: true, stir: true } } },
  });
  if (recs.length === 0) return null;
  const name = recs[0].firm.shortName?.trim() || recs[0].firm.legalName?.trim() || '';
  const rows: ReportRow[] = recs.map((r, i) => ({
    tr: i + 1, invoiceNo: r.invoiceNo, firmName: r.firm.shortName?.trim() || name,
    stir: (r.firm.stir ?? '').replace(/\D/g, ''), amount: Number(r.amount),
    pdf: r.pdfPath ? `${r.invoiceNo}.pdf` : '-',
    status: r.status === 'FAILED' ? 'Xatolik' : 'Muvaffaqiyatli',
  }));
  return { firmName: name, rows };
}

async function saveRecord(batchId: string, firmId: number, payload: RestPayload, invoiceNo: string, pdfPath: string | null) {
  await prisma.invoiceRecord.upsert({
    where: { invoiceNo },
    update: { pdfPath: pdfPath ?? undefined, restBatchId: batchId },
    create: {
      invoiceNo, firmId, restBatchId: batchId, paymentType: 'Почта харажатлари', amount: payload.amount,
      courtType: payload.courtType, courtRegion: '', court: payload.courtId,
      pdfPath: pdfPath ?? undefined, status: 'CREATED',
    },
  });
}

/** In-memory progress'ni bazaga sinxronlaydi (xato bo'lsa jarayonni to'xtatmaydi). */
async function persistBatch(b: Batch): Promise<void> {
  try {
    await prisma.invoiceRestBatch.update({
      where: { id: b.id },
      data: { ok: b.ok, failed: b.failed, phase: b.phase },
    });
  } catch { /* baza yozuvi ixtiyoriy — progress xotirada davom etadi */ }
}

function makeBatch(firmId: number, total: number, amount: number): Batch {
  const id = newId();
  const batch: Batch = {
    id, firmId, amount, total, done: 0, ok: 0, failed: 0, current: 0, phase: 'RUNNING', pauseLeftMs: 0,
    items: Array.from({ length: total }, (_, i) => ({ index: i, status: 'PENDING' as ItemStatus })),
  };
  batches.set(id, batch);
  return batch;
}

/**
 * Umumiy fon runner. `attemptOne(idx)` bitta kvitansiyani yaratib invoiceNo
 * qaytaradi (xatoda throw qiladi). Runner har item'ni MAX_ITEM_ATTEMPTS marta
 * urinadi — transient xatolar yutiladi, so'ralgan son to'liq chiqadi (100=100).
 * Agar bitta item 3 tada ham bo'lmasa → bu IP blok/tarmoq: paket to'xtaydi
 * (BLOCKED), aniq xato beriladi (jimgina kam berilmaydi).
 * Guruhlarga bo'lib (har guruhda CONCURRENCY parallel), guruhlar orasida katta
 * tanaffus bilan (IP himoyasi — «15 ta, 15s pauza») ishlaydi.
 */
async function runBatchLoop(batch: Batch, attemptOne: (idx: number) => Promise<string>): Promise<void> {
  // Bitta slot: 3 martagacha urinadi. Muvaffaqiyat → false; 3 ta ham bo'lmasa → true (abort).
  const processWithRetry = async (idx: number): Promise<boolean> => {
    const item = batch.items[idx];
    for (let attempt = 1; attempt <= MAX_ITEM_ATTEMPTS; attempt++) {
      // Boshqa worker allaqachon abort qo'ygan bo'lsa — bloklangan endpointga urmaymiz.
      if (batch.aborted) return true;
      try {
        const invoiceNo = await attemptOne(idx);
        item.status = 'OK'; item.invoiceNo = invoiceNo; item.message = undefined;
        batch.ok += 1; batch.done += 1;
        return false;
      } catch (e) {
        item.message = e instanceof Error ? e.message : String(e);
        if (attempt < MAX_ITEM_ATTEMPTS && !batch.aborted) await sleep(ITEM_RETRY_BACKOFF * attempt);
      }
    }
    item.status = 'FAILED'; batch.failed += 1; batch.done += 1;
    // Xato turini ajratamiz: blok/tarmoq → «IP blok»; deterministik → «server rad etdi».
    // Ikkalasi ham to'xtatadi (jimgina kam berilmaydi), lekin faqat birinchi hard-fail
    // xabari saqlanadi (ildizga eng yaqin), keyingi worker'lar ustidan yozmaydi.
    if (!batch.error) {
      const msg = item.message ?? '';
      batch.error = isBlockError(msg)
        ? `IP bloklandi yoki tarmoq ishlamayapti — 3 marta urinildi.${msg ? ` (${msg})` : ''}`
        : `Kvitansiya yaratilmadi — server rad etdi (3 marta urinildi).${msg ? ` (${msg})` : ''}`;
    }
    return true; // hard fail → butun paketni to'xtatamiz
  };

  for (let start = 0; start < batch.total && !batch.aborted; start += BATCH_SIZE) {
    batch.phase = 'RUNNING';
    const end = Math.min(start + BATCH_SIZE, batch.total);
    let pointer = start;
    const worker = async () => {
      while (pointer < end && !batch.aborted) {
        const idx = pointer++;
        batch.current = idx + 1;
        const hardFail = await processWithRetry(idx);
        await persistBatch(batch);
        if (hardFail) { batch.aborted = true; return; }
        if (pointer < end && !batch.aborted) await sleep(DELAY_BETWEEN_REQUESTS);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, end - start) }, () => worker()));
    if (batch.aborted) break;

    if (end < batch.total) {
      batch.phase = 'PAUSING';
      await persistBatch(batch);
      const until = Date.now() + BATCH_PAUSE_MS;
      while (Date.now() < until) { batch.pauseLeftMs = until - Date.now(); await sleep(500); }
      batch.pauseLeftMs = 0;
    }
  }
  batch.phase = batch.aborted ? 'BLOCKED' : 'DONE';
  // BLOCKED da current'ni total ga qotirmaymiz — qancha ishlangani (done) ko'rinsin.
  if (!batch.aborted) batch.current = batch.total;
  await persistBatch(batch);
}

export interface StartRestInput { firmId: number; count: number; }

/** Firma bo'yicha ommaviy paket (/invoyslar) — case'ga bog'lanmaydi. Summa: boji (getBojiAmount). */
export async function startRestBatch(input: StartRestInput): Promise<{ batchId: string; total: number }> {
  const firm = await prisma.firm.findUnique({ where: { id: input.firmId } });
  if (!firm) throw new Error('Firma topilmadi');
  // Takroriy start qulfi — bir firmaga bir vaqtda ikki paket = ikki marta kvitansiya (pul).
  if (hasActiveBatchForFirm(input.firmId)) throw new Error('Bu firma uchun paket allaqachon ishlayapti — tugashini kuting.');
  const amount = await getBojiAmount();
  const payload = buildRestPayload(firm, { amount });
  if (!payload.juridicalEntity.name) throw new Error('Firma nomi yo‘q');
  if (!payload.juridicalEntity.tin) throw new Error('Firma STIR raqami yo‘q');
  if (!payload.juridicalEntity.address) {
    throw new Error('Firma manzili toʻldirilmagan — «Firmalar» boʻlimida Viloyat, Tuman va koʻcha kiriting.');
  }

  const total = Math.max(1, Math.min(MAX_COUNT, Math.floor(input.count) || 1));
  const batch = makeBatch(input.firmId, total, amount);
  try {
    await prisma.invoiceRestBatch.create({ data: { id: batch.id, firmId: input.firmId, total, phase: 'RUNNING' } });
  } catch { /* baza yozuvi ixtiyoriy */ }

  const attemptOne = async (): Promise<string> => {
    const token = await getCaptchaToken();
    const invoiceNo = await createInvoiceRest(token, payload); // MINT — bundan keyin throw yo'q
    let pdfPath: string | null = null;
    try { pdfPath = await downloadInvoicePdf(invoiceNo); } catch { /* raqam saqlanadi, PDF ixtiyoriy */ }
    // DB yozuvi best-effort: xato bo'lsa ham attemptOne'dan CHIQMAYDI — aks holda retry
    // qayta kvitansiya yaratardi (pul isrofi). Kvitansiya allaqachon billing'da bor.
    try { await saveRecord(batch.id, input.firmId, payload, invoiceNo, pdfPath); } catch { /* re-mint qilmaymiz */ }
    return invoiceNo;
  };

  void runBatchLoop(batch, attemptOne);
  return { batchId: batch.id, total };
}

export interface StartCasesInput { firmId: number; snapshotId?: number; count: number; }

/**
 * Konveyer BOJ qadami: firmaning imzodan o'tgan (SIGNED_SCANNED, kvitansiyasiz)
 * eng eski N ta case'iga HAQIQIY billing boji kvitansiyasi yaratadi va har birini
 * o'sha case'ga bog'laydi (InvoiceRecord.caseId + ArizaCase.receiptNumber/stage).
 * Farmoyish uchun InvoiceBatch ham yaratiladi. Jonli progress — InvoiceRestBatch.
 */
export async function startRestBatchForCases(
  input: StartCasesInput,
): Promise<{ restBatchId: string | null; invoiceBatchId: number | null; total: number }> {
  const firm = await prisma.firm.findUnique({ where: { id: input.firmId } });
  if (!firm) throw new Error('Firma topilmadi');
  // Takroriy start qulfi — bir case'ga ikki marta real boji kvitansiyasi bo'lmasligi uchun.
  if (hasActiveBatchForFirm(input.firmId)) throw new Error('Bu firma uchun paket allaqachon ishlayapti — tugashini kuting.');

  const count = Math.max(1, Math.min(MAX_COUNT, Math.floor(input.count) || 1));
  const picked = await prisma.arizaCase.findMany({
    where: {
      firmId: input.firmId, stage: 'SIGNED_SCANNED', receiptNumber: null,
      ...(input.snapshotId ? { snapshotId: input.snapshotId } : {}),
    },
    orderBy: { id: 'asc' }, take: count, select: { id: true },
  });
  if (picked.length === 0) return { restBatchId: null, invoiceBatchId: null, total: 0 };

  const amount = await getBojiAmount();
  const payload = buildRestPayload(firm, { amount });
  if (!payload.juridicalEntity.name) throw new Error('Firma nomi yo‘q');
  if (!payload.juridicalEntity.tin) throw new Error('Firma STIR raqami yo‘q');
  if (!payload.juridicalEntity.address) {
    throw new Error('Firma manzili toʻldirilmagan — «Firmalar» boʻlimida Viloyat, Tuman va koʻcha kiriting.');
  }

  // Farmoyish (buxgalteriya) uchun InvoiceBatch — mavjud tarix/farmoyish UI ishlashi uchun.
  const invBatch = await prisma.invoiceBatch.create({
    data: { firmId: input.firmId, requestedCount: picked.length, createdCount: 0, status: 'GENERATING' },
    select: { id: true },
  });

  const total = picked.length;
  const batch = makeBatch(input.firmId, total, amount);
  try {
    await prisma.invoiceRestBatch.create({ data: { id: batch.id, firmId: input.firmId, total, phase: 'RUNNING' } });
  } catch { /* baza yozuvi ixtiyoriy */ }

  const now = new Date();
  const dueAt = await dueForStage('INVOICE_CREATED', now);

  const attemptOne = async (idx: number): Promise<string> => {
    const caseId = picked[idx].id;
    const token = await getCaptchaToken();
    const invoiceNo = await createInvoiceRest(token, payload); // MINT — bundan keyin throw yo'q
    let pdfPath: string | null = null;
    try { pdfPath = await downloadInvoicePdf(invoiceNo); } catch { /* raqam saqlanadi, PDF ixtiyoriy */ }
    // Mint muvaffaqiyatli. Bundan keyingi DB xatolari attemptOne'dan CHIQMAYDI — aks holda
    // retry qayta kvitansiya yaratardi (pul isrofi). Kvitansiya allaqachon billing'da bor.
    try {
      await prisma.$transaction(async (tx) => {
        // Avval case'ni guard bilan da'vo qilamiz. 0 qator bo'lsa (case allaqachon
        // olingan) — InvoiceRecord'ni caseId'siz yozamiz, stale caseId qoldirmaymiz.
        const claimed = await tx.arizaCase.updateMany({
          where: { id: caseId, receiptNumber: null },
          data: { receiptNumber: invoiceNo, invoiceNo, batchId: invBatch.id, stage: 'INVOICE_CREATED', stageEnteredAt: now, dueAt },
        });
        const linkCaseId = claimed.count > 0 ? caseId : null;
        await tx.invoiceRecord.upsert({
          where: { invoiceNo },
          update: { pdfPath: pdfPath ?? undefined, restBatchId: batch.id, caseId: linkCaseId },
          create: {
            invoiceNo, firmId: input.firmId, restBatchId: batch.id, caseId: linkCaseId,
            paymentType: 'Давлат божи', amount, courtType: payload.courtType, courtRegion: '',
            court: payload.courtId, pdfPath: pdfPath ?? undefined, status: 'CREATED',
          },
        });
      });
    } catch {
      // Tranzaksiya uzildi — kvitansiya baribir yaratilgan. Best-effort: caseId'siz yozib
      // qo'yamiz (izsiz qolmasin), lekin QAYTA yaratmaymiz.
      try {
        await prisma.invoiceRecord.upsert({
          where: { invoiceNo },
          update: { pdfPath: pdfPath ?? undefined, restBatchId: batch.id },
          create: {
            invoiceNo, firmId: input.firmId, restBatchId: batch.id, paymentType: 'Давлат божи',
            amount, courtType: payload.courtType, courtRegion: '', court: payload.courtId,
            pdfPath: pdfPath ?? undefined, status: 'CREATED',
          },
        });
      } catch { /* iz ham qolmasa — hech bo'lmasa re-mint qilmadik */ }
    }
    return invoiceNo;
  };

  void runBatchLoop(batch, attemptOne).then(async () => {
    try {
      await prisma.invoiceBatch.update({
        where: { id: invBatch.id },
        data: { createdCount: batch.ok, status: batch.aborted ? 'FAILED' : 'DONE' },
      });
    } catch { /* farmoyish batch yangilanmasa ham progress bazada bor */ }
  });

  return { restBatchId: batch.id, invoiceBatchId: invBatch.id, total };
}
