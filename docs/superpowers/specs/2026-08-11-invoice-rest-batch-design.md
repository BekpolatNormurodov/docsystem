# Invoice — tez REST paket rejimi (dizayn)

Sana: 2026-08-11

## Maqsad

`/invoyslar` sahifasidagi sekin Playwright (brauzer + qo'lda captcha) oqimini
Desktopdagi `more_invoice.js` REST usuliga o'tkazish. Foydalanuvchi firma tanlaydi,
son (1–100) kiritadi, "Boshlash" bosadi — jarayon **fonda** ishlaydi, UI'da jonli
sanoq/loading ko'rinadi, tugagach barcha PDF'lar bitta **ZIP** bo'lib yuklanadi.

## Xatti-harakat (asosiy oqim)

1. Har bir invoice uchun captcha token olinadi (`recaptcha.sud.uz/api/v1/captcha/analyze`).
   - `challengeRequired:false` → token to'g'ridan-to'g'ri ishlatiladi.
   - Challenge kelsa → **skip** qilib `analyze` qayta chaqiriladi (max 5 urinish).
     Baribir token bo'lmasa o'sha invoice `FAILED` deb belgilanadi (odam aralashmaydi).
2. Token bilan invoice yaratiladi (`billing.sud.uz/api/invoice/captcha/create`).
3. Invoice raqami bilan PDF yuklanadi (`asDocument`) → `storage/invoices/{no}.pdf`.
4. Ketma-ketlik: **15 talik guruh**, guruhdan keyin **15s pauza**, oraliqda ~2.5s.
5. Har bir natija `InvoiceRecord`ga yoziladi (mavjud model).

## Payload

Konstanta (skriptdagidek, o'zgarmaydi):
`amount: 2060000`, `courtId: "525"`, `courtType: "CITIZEN"`, `entityType: "JURIDICAL"`,
`payCategoryId: 3`, `isInFavor: true`, `overdue: 0`, `description: ""`.

Firmadan olinadi:
`juridicalEntity.name` (firm.shortName || legalName), `juridicalEntity.tin` (firm.stir),
`juridicalEntity.address` = `[region, district, addressLine].filter(Boolean).join(', ')`.

Manzil to'liq bo'lmasa (firmada region/tuman/ko'cha yo'q) — start bosilganda
xato qaytariladi ("Firma manzili to'ldirilmagan").

## Komponentlar

### `src/lib/invoice-rest.ts` (yangi — REST yadro)
- `getCaptchaToken(): Promise<string>` — analyze + skip-retry.
- `createInvoiceRest(token, payload): Promise<{ invoiceNo }>`.
- `downloadInvoicePdf(invoiceNo): Promise<relPath>` — REST orqali PDF.
- `buildRestPayload(firm): RestPayload` — konstanta + firma maydonlari.
- `startRestBatch({ firmId, count }): { batchId }` — fon jarayon.
- `getRestBatch(batchId): Progress | null`.
- Fon jarayon uchun `fetchWithRetry` (timeout + 429/403 aniqlash + backoff) —
  `more_invoice.js`dan ko'chiriladi.

### Progress holati (count asosida)
```
{ total, done, ok, failed, current, phase: 'RUNNING'|'PAUSING'|'DONE',
  pauseLeftMs, items: [{ index, status: 'PENDING'|'OK'|'FAILED', invoiceNo?, message? }] }
```
Global `Map` (mavjud `__invoiceBatches` pattern kabi, HMR-safe).

### API routelar
- `POST /api/invoices/start` — `{ firmId, count }`, count `1..100` clamp. `startRestBatch` chaqiradi.
- `GET /api/invoices/batch/[id]` — progress (1.5s poll).
- `GET /api/invoices/batch/[id]/zip` — `phase==='DONE'` bo'lsa, batchdagi PDF'larni
  `adm-zip` bilan bitta arxiv qilib oqim (stream) qaytaradi.

### UI — `InvoiceCreateForm.tsx`
- Maydonlar: Firma (select) + Son (1–100) + "Boshlash".
- Captcha/summa/to'lov-turi maydonlari **olib tashlanadi**.
- Ishga tushgach: progress bar + jonli sanoq (`12 / 50 · ✓10 ✗2`), joriy holat
  ("Ishlayapti…" / "Pauza 15s…"), poll orqali yangilanadi.
- `DONE` bo'lgach: "ZIP yuklab olish" tugmasi (`/api/invoices/batch/[id]/zip`).

## Olib tashlanadi
- `src/lib/invoice-automation.ts` (Playwright oqim).
- `src/core/invoice-fields.ts` dan brauzer-form maydonlari (court dropdown nomlari) —
  agar boshqa joyda ishlatilmasa; ishlatilsa faqat kerakli qismi qoldiriladi.
- `InvoiceList` (tarix jadvali) **qoladi**.

## Test
- `buildRestPayload` — firmadan to'g'ri payload (konstanta + name/tin/address).
- Manzil bo'sh firma → start xato.
- Captcha skip-retry — challenge javobida limitgacha urinib, keyin FAILED.
- Batch bo'linishi — 15 talik guruh + pauza mantiqi (birlik test yoki qo'lda).
