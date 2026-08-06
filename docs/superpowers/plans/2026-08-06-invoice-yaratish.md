# «Invoice yaratish» Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Docsystem'ga sidebar orqali `billing.sud.uz`'da ko'plab kvitansiya yaratishni yarim-avtomatlashtiruvchi modul qo'shish — forma avtomat to'ldiriladi, PDF+raqam tizimga yig'iladi, «Robot emasman» + «Yaratish» esa qo'lda bosiladi.

**Architecture:** Next.js 14 App Router server komponentlari prisma'ni to'g'ridan-to'g'ri o'qiydi; API route'lar (`runtime = 'nodejs'`) server-side Playwright (headed Chromium) ni boshqaradi. Playwright brauzer/tab handle'lari modul-singleton kontrollerda yashaydi (import Job polling patternidek, lekin jonli brauzer bilan). Sof «field-plan» moduli Playwright'siz unit-test qilinadi.

**Tech Stack:** Next.js 14.2, TypeScript strict, Prisma 5.22 + MySQL 8, Playwright (chromium), Tailwind, Vitest.

## Global Constraints

- **Anti-bot chegara (buzilmas):** Avtomatlashtirish «Robot emasman» checkbox'ini va yakuniy «Yaratish» tugmasini HECH QACHON o'zi bosmaydi. Driver captcha'dan oldin to'xtaydi; bu ikki bosish faqat foydalanuvchida. Bu chegarani buzadigan kod yozilmaydi.
- DB paroli faqat git-ignored `.env`/`.env.test`da; commit qilinmaydi.
- Barcha API route'lar `requireAdmin()` bilan himoyalanadi va `export const runtime = 'nodejs'`.
- Server komponentlar `export const dynamic = 'force-dynamic'`.
- Til: UI matnlari o'zbek lotin (mavjud uslub); sud maydonlari billing saytidagidek kirill.
- Default qiymatlar: Soni **1**, To'lov turi **«Почта харажатлари»**, Summa **20600**, Sud turi **«Фуқаролик ишлари бўйича»**, Sud hududi **«Тошкент шаҳар»**, Sud **«Фуқаролик ишлари бўйича Учтепа туманлараро суди»**.
- PDF fayllar `storage/invoices/` (process.cwd() ostida) da saqlanadi; jild yo'q bo'lsa yaratiladi.
- Playwright locator'lari billing formadagi ko'rinadigan placeholder/label matnlariga asoslanadi (masalan «Tashkilot nomi», «STIR»); MUI dropdownlar bosib ochilib, variant kirill matni bo'yicha tanlanadi.

---

### Task 1: Prisma schema — Firm manzil maydonlari + InvoiceRecord modeli

**Files:**
- Modify: `prisma/schema.prisma` (Firm modeliga 3 maydon; yangi InvoiceRecord model)

**Interfaces:**
- Produces: `Firm.region/district/addressLine` (String?), `InvoiceRecord` modeli (keyingi barcha tasklar shu tiplarni ishlatadi).

- [ ] **Step 1: Firm modeliga manzil komponentlarini qo'shish**

`prisma/schema.prisma` — Firm modelida `address` qatoridan keyin:

```prisma
  address     String?
  region      String? // billing «Viloyat» dropdown ko'rinadigan matni, masalan "Тошкент шаҳар"
  district    String? // billing «Tuman» dropdown matni, masalan "Олмазор тумани"
  addressLine String? // ko'cha/uy, masalan "Gurushariq MFY, Sag'bon kochasi 30-berk 7/1"
```

- [ ] **Step 2: InvoiceRecord modelini qo'shish**

`prisma/schema.prisma` oxiriga:

```prisma
model InvoiceRecord {
  id          Int      @id @default(autoincrement())
  invoiceNo   String   @unique
  firmId      Int
  firm        Firm     @relation(fields: [firmId], references: [id])
  paymentType String
  amount      Decimal  @db.Decimal(20, 2)
  courtType   String
  courtRegion String
  court       String
  pdfPath     String?
  status      String   @default("CREATED") // CREATED | FAILED
  createdAt   DateTime @default(now())

  @@index([firmId])
}
```

- [ ] **Step 3: Firm modeliga teskari relation qo'shish**

`Firm` modeli ichiga (updatedAt dan oldin):

```prisma
  invoices    InvoiceRecord[]
```

- [ ] **Step 4: Schema'ni bazaga ko'chirish va client generatsiya**

Run: `npx prisma db push --skip-generate && npx prisma generate`
Expected: «Your database is now in sync» + «Generated Prisma Client». Xato bo'lmasin.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(invoice): Firm address parts + InvoiceRecord model"
```

---

### Task 2: FirmForm — manzil komponentlarini tahrirlash

**Files:**
- Modify: `src/app/(app)/firms/FirmForm.tsx`

**Interfaces:**
- Consumes: `Firm` (Task 1 tiplardagi yangi maydonlar).
- Produces: firmalar sahifasida region/district/addressLine tahrirlanadi (Task 4 shu ma'lumotni o'qiydi).

- [ ] **Step 1: FirmFields tipiga yangi kalitlarni qo'shish**

`FirmForm.tsx` — `FirmFields` tipi:

```tsx
type FirmFields = Record<
  | 'shortName' | 'legalName' | 'address' | 'bankAccount' | 'mfo' | 'stir' | 'postIndex' | 'phone'
  | 'region' | 'district' | 'addressLine',
  string
>;
```

- [ ] **Step 2: toFields'ga yangi maydonlarni qo'shish**

`toFields` ichiga qaytariladigan obyektga:

```tsx
    region: firm.region ?? '',
    district: firm.district ?? '',
    addressLine: firm.addressLine ?? '',
```

- [ ] **Step 3: Modalga yangi TextField'larni qo'shish**

`FirmForm` ichidagi grid'da `Manzil` TextField'idan keyin:

```tsx
        <TextField label="Viloyat (billing)" value={fields.region} onChange={set('region')} />
        <TextField label="Tuman (billing)" value={fields.district} onChange={set('district')} />
        <TextField label="Koʻcha/uy (billing manzil)" value={fields.addressLine} onChange={set('addressLine')} className="sm:col-span-2" />
```

(PATCH route `data`ni to'g'ridan-to'g'ri `prisma.firm.update`ga beradi, yangi maydonlar avtomat saqlanadi — route o'zgartirilmaydi.)

- [ ] **Step 4: Tekshirish (typecheck)**

Run: `npx tsc --noEmit`
Expected: xato yo'q.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/firms/FirmForm.tsx
git commit -m "feat(invoice): edit region/district/addressLine on firm"
```

---

### Task 3: Sof «field-plan» moduli + defaultlar (Playwright'siz, unit-test)

**Files:**
- Create: `src/core/invoice-fields.ts`
- Test: `src/core/invoice-fields.test.ts`

**Interfaces:**
- Consumes: `Firm` (Task 1).
- Produces:
  - `INVOICE_DEFAULTS`, `PAYMENT_TYPES` (Option[]-mos), `COURT_DEFAULTS`
  - tip `InvoiceFormData` { orgName, stir, region, district, addressLine, courtType, courtRegion, court, paymentType, amount }
  - `buildInvoiceForm(firm, sel): InvoiceFormData` — Task 4 va Task 6 shuni ishlatadi.

- [ ] **Step 1: Failing test yozish**

`src/core/invoice-fields.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildInvoiceForm, INVOICE_DEFAULTS, PAYMENT_TYPES } from './invoice-fields';

const firm = {
  id: 1, code: '1', shortName: 'bright future', legalName: null,
  address: null, region: 'Тошкент шаҳар', district: 'Олмазор тумани',
  addressLine: "Sag'bon 7/1", bankAccount: null, mfo: null, stir: '311976765',
  postIndex: null, phone: null, region_: null,
} as any;

describe('buildInvoiceForm', () => {
  it('maps firm fields and applies selections', () => {
    const f = buildInvoiceForm(firm, { paymentType: 'Почта харажатлари', amount: 20600 });
    expect(f.orgName).toBe('bright future');
    expect(f.stir).toBe('311976765');
    expect(f.region).toBe('Тошкент шаҳар');
    expect(f.district).toBe('Олмазор тумани');
    expect(f.amount).toBe(20600);
    expect(f.paymentType).toBe('Почта харажатлари');
    expect(f.courtType).toBe(INVOICE_DEFAULTS.courtType);
    expect(f.court).toBe(INVOICE_DEFAULTS.court);
  });

  it('falls back to legalName when shortName missing', () => {
    const f = buildInvoiceForm({ ...firm, shortName: '', legalName: 'BRIGHT FUTURE LLC' },
      { paymentType: 'Давлат божи', amount: 5000 });
    expect(f.orgName).toBe('BRIGHT FUTURE LLC');
  });

  it('exposes three payment types', () => {
    expect(PAYMENT_TYPES.map((p) => p.value)).toEqual([
      'Давлат божи', 'Почта харажатлари', 'Видеоконференцалоқа харажатлари',
    ]);
  });
});
```

- [ ] **Step 2: Testni ishga tushirib fail bo'lishini ko'rish**

Run: `npx vitest run src/core/invoice-fields.test.ts`
Expected: FAIL — «invoice-fields» topilmadi.

- [ ] **Step 3: Modulni yozish**

`src/core/invoice-fields.ts`:

```ts
import type { Firm } from '@prisma/client';

export const COURT_DEFAULTS = {
  courtType: 'Фуқаролик ишлари бўйича',
  courtRegion: 'Тошкент шаҳар',
  court: 'Фуқаролик ишлари бўйича Учтепа туманлараро суди',
} as const;

export const INVOICE_DEFAULTS = {
  count: 1,
  paymentType: 'Почта харажатлари',
  amount: 20600,
  ...COURT_DEFAULTS,
} as const;

/** Billing «To'lov turi» dropdown — uchta statik variant (kirill, saytdagidek). */
export const PAYMENT_TYPES: { value: string; label: string }[] = [
  { value: 'Давлат божи', label: 'Давлат божи' },
  { value: 'Почта харажатлари', label: 'Почта харажатлари' },
  { value: 'Видеоконференцалоқа харажатлари', label: 'Видеоконференцалоқа харажатлари' },
];

export interface InvoiceSelections {
  paymentType: string;
  amount: number;
}

export interface InvoiceFormData {
  orgName: string;
  stir: string;
  region: string;
  district: string;
  addressLine: string;
  courtType: string;
  courtRegion: string;
  court: string;
  paymentType: string;
  amount: number;
}

/** Firm + foydalanuvchi tanlovidan billing formasi uchun to'liq maydonlar to'plamini yig'adi. */
export function buildInvoiceForm(firm: Firm, sel: InvoiceSelections): InvoiceFormData {
  return {
    orgName: firm.shortName?.trim() || firm.legalName?.trim() || '',
    stir: firm.stir ?? '',
    region: firm.region ?? '',
    district: firm.district ?? '',
    addressLine: firm.addressLine ?? '',
    courtType: COURT_DEFAULTS.courtType,
    courtRegion: COURT_DEFAULTS.courtRegion,
    court: COURT_DEFAULTS.court,
    paymentType: sel.paymentType,
    amount: sel.amount,
  };
}
```

- [ ] **Step 4: Test o'tishini tekshirish**

Run: `npx vitest run src/core/invoice-fields.test.ts`
Expected: PASS (3 test).

- [ ] **Step 5: Commit**

```bash
git add src/core/invoice-fields.ts src/core/invoice-fields.test.ts
git commit -m "feat(invoice): field-plan builder + defaults (unit-tested)"
```

---

### Task 4: Playwright driver + batch kontroller (singleton)

**Files:**
- Create: `src/lib/invoice-automation.ts`
- Test: `src/lib/invoice-automation.test.ts`
- Modify: `package.json` (playwright dependency)

**Interfaces:**
- Consumes: `InvoiceFormData` + `buildInvoiceForm` (Task 3), `prisma` (`src/lib/db`).
- Produces:
  - `fillInvoiceForm(page: FillablePage, data: InvoiceFormData): Promise<void>` — captcha'dan OLDIN to'xtaydi (test qilinadi).
  - `startBatch(input: { firmId: number; count: number; paymentType: string; amount: number }): Promise<{ batchId: string; tabs: number }>`
  - `getBatch(batchId: string): BatchStatus | null` — { tabs: TabState[] }
  - tip `TabState` { index: number; status: 'FILLING'|'WAITING_HUMAN'|'SUBMITTED'|'CAPTURED'|'FAILED'; invoiceNo?: string; message?: string }

- [ ] **Step 1: Playwright'ni o'rnatish**

Run: `npm install -D playwright && npx playwright install chromium`
Expected: playwright `package.json` devDependencies'ga qo'shiladi; chromium yuklab olinadi.

- [ ] **Step 2: Driver uchun failing test yozish (mock Page)**

`src/lib/invoice-automation.test.ts` — Playwright'siz, minimal Page interfeysini mock qilamiz. Driver captcha'ga TEGMASLIGINI va maydonlarni to'ldirishini tekshiradi:

```ts
import { describe, it, expect, vi } from 'vitest';
import { fillInvoiceForm, type FillablePage } from './invoice-automation';
import type { InvoiceFormData } from '@/core/invoice-fields';

function makePage() {
  const calls: string[] = [];
  const locator = (id: string) => ({
    click: vi.fn(async () => { calls.push(`click:${id}`); }),
    fill: vi.fn(async (v: string) => { calls.push(`fill:${id}=${v}`); }),
    selectByText: vi.fn(async (t: string) => { calls.push(`select:${id}=${t}`); }),
  });
  const page: FillablePage = {
    getByPlaceholder: (t: string) => locator(`ph:${t}`),
    getByText: (t: string) => locator(`text:${t}`),
    getByRole: (r: string, o?: { name?: string }) => locator(`role:${r}:${o?.name ?? ''}`),
  } as any;
  return { page, calls };
}

const data: InvoiceFormData = {
  orgName: 'bright future', stir: '311976765', region: 'Тошкент шаҳар',
  district: 'Олмазор тумани', addressLine: "Sag'bon 7/1",
  courtType: 'Фуқаролик ишлари бўйича', courtRegion: 'Тошкент шаҳар',
  court: 'Фуқаролик ишлари бўйича Учтепа туманлараро суди',
  paymentType: 'Почта харажатлари', amount: 20600,
};

describe('fillInvoiceForm', () => {
  it('fills org name, stir and amount', async () => {
    const { page, calls } = makePage();
    await fillInvoiceForm(page, data);
    expect(calls).toContain('fill:ph:Tashkilot nomi=bright future');
    expect(calls).toContain('fill:ph:STIR=311976765');
    expect(calls.some((c) => c.includes('20600'))).toBe(true);
  });

  it('NEVER touches the captcha or submit', async () => {
    const { page, calls } = makePage();
    await fillInvoiceForm(page, data);
    expect(calls.some((c) => /Robot emasman/i.test(c))).toBe(false);
    expect(calls.some((c) => /Yaratish/i.test(c))).toBe(false);
  });
});
```

- [ ] **Step 3: Testni ishga tushirib fail bo'lishini ko'rish**

Run: `npx vitest run src/lib/invoice-automation.test.ts`
Expected: FAIL — modul topilmadi.

- [ ] **Step 4: Driver + kontrollerni yozish**

`src/lib/invoice-automation.ts`. DIQQAT (implementer uchun): quyidagi locator matnlari billing formadagi ko'rinadigan placeholder'larga asoslangan (skриншотlardan: «Tashkilot nomi», «STIR», «Tashkilot manzili», «Sud turi», «Sud hududi», «Sud», «To'lov turi», «Kvitansiya summasi»). Step 5'da jonli DOM'ga solishtirib, agar aniq matn farq qilsa shu joyda to'g'rilanadi — mantiq o'zgarmaydi.

```ts
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
```

- [ ] **Step 5: Jonli DOM'ga solishtirib locator matnlarini tasdiqlash**

`https://billing.sud.uz/create-receipt`'ni Playwright bilan ochib (yoki brauzer devtools'da) Step 4'dagi placeholder/label/tugma matnlari aynan mosligini tekshiring. Farq bo'lsa faqat matn qatorlarini to'g'rilang (masalan getByPlaceholder → getByLabel). Mantiq va tartib o'zgarmaydi. Bu qadam kod emas — tekshiruv; natijasini task hisobotida yozing.

- [ ] **Step 6: Testni o'tkazish**

Run: `npx vitest run src/lib/invoice-automation.test.ts`
Expected: PASS (2 test) — fill maydonlari to'g'ri, captcha/Yaratish'ga tegilmagan.

- [ ] **Step 7: Commit**

```bash
git add src/lib/invoice-automation.ts src/lib/invoice-automation.test.ts package.json package-lock.json
git commit -m "feat(invoice): Playwright fill driver + batch controller"
```

---

### Task 5: API route'lar — start / batch-status / pdf-download

**Files:**
- Create: `src/app/api/invoices/start/route.ts`
- Create: `src/app/api/invoices/batch/[id]/route.ts`
- Create: `src/app/api/invoices/[id]/download/route.ts`

**Interfaces:**
- Consumes: `startBatch`, `getBatch` (Task 4), `prisma`, `requireAdmin`.
- Produces: POST `/api/invoices/start` → `{ batchId, tabs }`; GET `/api/invoices/batch/{id}` → `{ tabs }`; GET `/api/invoices/{recordId}/download` → PDF fayl.

- [ ] **Step 1: start route**

`src/app/api/invoices/start/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { startBatch } from '@/lib/invoice-automation';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  await requireAdmin();
  const body = await req.json().catch(() => ({}));
  const firmId = Number(body?.firmId);
  const count = Math.max(1, Math.min(10, Number(body?.count) || 1));
  const paymentType = String(body?.paymentType ?? 'Почта харажатлари');
  const amount = Number(body?.amount);
  if (!firmId || !Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'firmId va summa toʻgʻri boʻlishi kerak' }, { status: 400 });
  }
  try {
    const res = await startBatch({ firmId, count, paymentType, amount });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Xatolik' }, { status: 500 });
  }
}
```

- [ ] **Step 2: batch-status route**

`src/app/api/invoices/batch/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getBatch } from '@/lib/invoice-automation';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  await requireAdmin();
  const b = getBatch(params.id);
  if (!b) return NextResponse.json({ error: 'topilmadi' }, { status: 404 });
  return NextResponse.json(b);
}
```

- [ ] **Step 3: pdf-download route**

`src/app/api/invoices/[id]/download/route.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  await requireAdmin();
  const rec = await prisma.invoiceRecord.findUnique({ where: { id: Number(params.id) } });
  if (!rec || !rec.pdfPath) return NextResponse.json({ error: 'topilmadi' }, { status: 404 });
  const abs = path.join(process.cwd(), rec.pdfPath);
  if (!fs.existsSync(abs)) return NextResponse.json({ error: 'topilmadi' }, { status: 404 });
  const stat = fs.statSync(abs);
  const stream = fs.createReadStream(abs);
  return new NextResponse(stream as unknown as ReadableStream, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${rec.invoiceNo}-kvitansiya.pdf"`,
      'Content-Length': String(stat.size),
    },
  });
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: xato yo'q.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/invoices
git commit -m "feat(invoice): start / batch-status / pdf-download API routes"
```

---

### Task 6: UI — sidebar punkt + /invoyslar sahifa + forma + ro'yxat

**Files:**
- Modify: `src/app/(app)/layout.tsx` (NAV)
- Create: `src/app/(app)/invoyslar/page.tsx` (server)
- Create: `src/app/(app)/invoyslar/InvoiceCreateForm.tsx` (client)
- Create: `src/app/(app)/invoyslar/InvoiceList.tsx` (client)

**Interfaces:**
- Consumes: `prisma`, `PAYMENT_TYPES`, `INVOICE_DEFAULTS`, `COURT_DEFAULTS` (Task 3), `TabState` shakli (Task 4), Task 5 route'lari.
- Produces: ishlaydigan «Invoice yaratish» sahifasi.

- [ ] **Step 1: Sidebarga NAV punkt qo'shish**

`src/app/(app)/layout.tsx` — NAV massiviga (Firmalar'dan oldin):

```tsx
  { href: '/invoyslar', label: 'Invoice yaratish', icon: 'file-plus' },
```

(`file-plus` mavjud ikonka — Import ham ishlatadi.)

- [ ] **Step 2: Server sahifa**

`src/app/(app)/invoyslar/page.tsx`:

```tsx
import { prisma } from '@/lib/db';
import { PageHeader } from '@/ui';
import { InvoiceCreateForm } from './InvoiceCreateForm';
import { InvoiceList, type InvoiceRow } from './InvoiceList';

export const dynamic = 'force-dynamic';

export default async function InvoyslarPage() {
  const [firms, records] = await Promise.all([
    prisma.firm.findMany({ orderBy: { shortName: 'asc' }, select: { id: true, shortName: true, stir: true, region: true, district: true, addressLine: true } }),
    prisma.invoiceRecord.findMany({ orderBy: { createdAt: 'desc' }, take: 100, include: { firm: { select: { shortName: true } } } }),
  ]);

  const rows: InvoiceRow[] = records.map((r) => ({
    id: r.id,
    invoiceNo: r.invoiceNo,
    firmName: r.firm.shortName,
    paymentType: r.paymentType,
    amount: Number(r.amount).toLocaleString('ru-RU'),
    createdLabel: r.createdAt.toLocaleString('ru-RU'),
    hasPdf: !!r.pdfPath,
  }));

  return (
    <div>
      <PageHeader title="Invoice yaratish" subtitle="Firma tanlang, sonini kiriting — forma avtomat toʻldiriladi, «Robot emasman» va «Yaratish» ni oʻzingiz bosasiz" />
      <InvoiceCreateForm firms={firms} />
      <InvoiceList rows={rows} />
    </div>
  );
}
```

- [ ] **Step 3: Yaratish formasi (client)**

`src/app/(app)/invoyslar/InvoiceCreateForm.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Select, TextField } from '@/ui';
import { PAYMENT_TYPES, INVOICE_DEFAULTS, COURT_DEFAULTS } from '@/core/invoice-fields';

interface FirmLite { id: number; shortName: string; stir: string | null; region: string | null; district: string | null; addressLine: string | null; }
interface TabState { index: number; status: string; invoiceNo?: string; message?: string; }

const STATUS_LABEL: Record<string, string> = {
  FILLING: 'Toʻldirilmoqda…',
  WAITING_HUMAN: '⏸ Captcha kuting — «Robot emasman» + «Yaratish» bosing',
  SUBMITTED: 'Yuborildi…',
  CAPTURED: '✓ Yaratildi',
  FAILED: '✗ Xatolik',
};

export function InvoiceCreateForm({ firms }: { firms: FirmLite[] }) {
  const router = useRouter();
  const [firmId, setFirmId] = useState(firms[0] ? String(firms[0].id) : '');
  const [count, setCount] = useState(String(INVOICE_DEFAULTS.count));
  const [paymentType, setPaymentType] = useState<string>(INVOICE_DEFAULTS.paymentType);
  const [amount, setAmount] = useState(String(INVOICE_DEFAULTS.amount));
  const [tabs, setTabs] = useState<TabState[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const firm = firms.find((f) => String(f.id) === firmId);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  function poll(batchId: string) {
    timer.current = setInterval(async () => {
      const res = await fetch(`/api/invoices/batch/${batchId}`);
      if (!res.ok) return;
      const data: { tabs: TabState[] } = await res.json();
      setTabs(data.tabs);
      const done = data.tabs.every((t) => t.status === 'CAPTURED' || t.status === 'FAILED');
      if (done && timer.current) { clearInterval(timer.current); setBusy(false); router.refresh(); }
    }, 1500);
  }

  async function onStart() {
    setBusy(true); setError(null); setTabs([]);
    try {
      const res = await fetch('/api/invoices/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firmId: Number(firmId), count: Number(count), paymentType, amount: Number(amount) }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Xatolik'); setBusy(false); return; }
      poll(data.batchId);
    } catch { setError('Ulanishda xatolik'); setBusy(false); }
  }

  return (
    <div className="card max-w-lg space-y-4 p-6">
      <Select label="Firma" value={firmId} onChange={setFirmId}
        options={firms.map((f) => ({ value: String(f.id), label: f.shortName }))} />

      <div className="grid grid-cols-2 gap-4">
        <TextField label="Soni" value={count} onChange={(v) => setCount(v.replace(/\D/g, '') || '1')} />
        <TextField label="Summa (soʻm)" value={amount} onChange={(v) => setAmount(v.replace(/\D/g, ''))} />
      </div>

      <Select label="Toʻlov turi" value={paymentType} onChange={setPaymentType} options={PAYMENT_TYPES} />

      <div className="rounded-xl border border-line bg-surface-2 p-3 text-xs text-muted">
        <div className="mb-1 font-semibold text-fg">Standart (default) qiymatlar:</div>
        <div>STIR: {firm?.stir || '—'} · Manzil: {[firm?.region, firm?.district, firm?.addressLine].filter(Boolean).join(', ') || '—'}</div>
        <div>Sud: {COURT_DEFAULTS.court}</div>
      </div>

      <button type="button" onClick={onStart} disabled={busy || !firmId}
        className="btn-primary w-full justify-center py-2.5 disabled:opacity-50">
        {busy ? 'Jarayonda…' : 'Boshlash'}
      </button>

      {error && <p className="text-sm text-rose-600 dark:text-rose-300">{error}</p>}

      {tabs.length > 0 && (
        <div className="space-y-2 border-t border-line pt-3">
          {tabs.map((t) => (
            <div key={t.index} className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-sm">
              <span>Tab #{t.index + 1}{t.invoiceNo ? ` · №${t.invoiceNo}` : ''}</span>
              <span className={t.status === 'FAILED' ? 'text-rose-500' : t.status === 'CAPTURED' ? 'text-emerald-600' : 'text-muted'}>
                {STATUS_LABEL[t.status] ?? t.status}{t.message ? ` — ${t.message}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Ro'yxat komponenti (client)**

`src/app/(app)/invoyslar/InvoiceList.tsx`:

```tsx
'use client';

import { DocumentDownload } from 'iconsax-react';

export interface InvoiceRow {
  id: number; invoiceNo: string; firmName: string; paymentType: string;
  amount: string; createdLabel: string; hasPdf: boolean;
}

export function InvoiceList({ rows }: { rows: InvoiceRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="card mt-6 overflow-hidden">
      <div className="border-b border-line px-4 py-3 text-sm font-semibold">Yaratilgan invoyslar ({rows.length})</div>
      <table className="w-full text-sm">
        <thead className="border-b border-line text-left text-xs text-muted">
          <tr>
            <th className="px-4 py-2 font-medium">№</th>
            <th className="px-4 py-2 font-medium">Firma</th>
            <th className="px-4 py-2 font-medium">Toʻlov turi</th>
            <th className="px-4 py-2 text-right font-medium">Summa</th>
            <th className="px-4 py-2 font-medium">Sana</th>
            <th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-line">
              <td className="px-4 py-2 font-mono text-xs">{r.invoiceNo}</td>
              <td className="px-4 py-2">{r.firmName}</td>
              <td className="px-4 py-2 text-muted">{r.paymentType}</td>
              <td className="px-4 py-2 text-right tabular-nums">{r.amount}</td>
              <td className="px-4 py-2 text-xs text-muted">{r.createdLabel}</td>
              <td className="px-4 py-2 text-right">
                {r.hasPdf ? (
                  <a href={`/api/invoices/${r.id}/download`} className="btn-primary px-3 py-1.5 text-xs">
                    <DocumentDownload size={14} /> PDF
                  </a>
                ) : <span className="text-xs text-muted">PDF yoʻq</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 5: Typecheck + build tekshiruv**

Run: `npx tsc --noEmit`
Expected: xato yo'q (ayniqsa Step 3'dagi `firms[0]` ASCII ekaniga ishonch hosil qiling).

- [ ] **Step 6: Commit**

```bash
git add src/app/\(app\)/layout.tsx src/app/\(app\)/invoyslar
git commit -m "feat(invoice): sidebar item + invoyslar page, create form, list"
```

---

## Self-Review eslatmalari (reja muallifi)

- **Spec qamrovi:** Firma+soni+to'lov turi+summa (Task 6), manzil DB (Task 1–2), Playwright fill captcha'gacha (Task 4), PDF+raqam saqlash (Task 4–5), ro'yxat (Task 6). Sud maydonlari v1 default (Task 3 COURT_DEFAULTS). ✓
- **Anti-bot chegara:** Task 4 driver captcha/Yaratish'ga tegmaydi va buni test isbotlaydi (Step 2 «NEVER touches the captcha»). ✓
- **Locator noaniqligi:** Task 4 Step 5 jonli DOM tekshiruvi — bu yagona «tashqi haqiqatga» bog'liq nuqta, ataylab alohida qadam qilingan.
- **Tiplar mosligi:** `TabState` (Task 4) ↔ UI `TabState` (Task 6) bir xil maydonlar; `InvoiceFormData` Task 3'da bir marta ta'riflangan.
