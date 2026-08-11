# Invoice step — REST paketni firma + mijoz(case)ga bog'lash (dizayn)

Sana: 2026-08-11

## Maqsad

Haqiqiy billing.sud.uz REST invoice yaratishni konveyerning **BOJ ("Invoice") qadamiga**
ulash. Hozir bu qadam (BuxgalterPanel) `createInvoiceBatch` orqali **soxta/lokal**
kvitansiya raqami beradi. Uni REST bilan almashtirib, har invoice'ni aniq **case →
(pinfl mijoz + firma + snapshot)** ga bog'laymiz. `/invoyslar` (firma bo'yicha ommaviy
pochta paketi) o'zgarishsiz qoladi.

## Qarorlar (tasdiqlangan)

- Summa/tur: **davlat boji, `getBojiAmount()` (default 20 600 so'm)**, `payCategoryId: 3`
  (pochta bilan bir xil — foydalanuvchi tasdiqladi), boshqa payload konstantalari o'zgarmaydi.
- Case filtri: **`stage='SIGNED_SCANNED'` + `receiptNumber=null`** (imzodan o'tgan, hali kvitansiyasiz).
- Soxta raqamli case'lar: **tegilmaydi** (faqat receiptNumber=null yangilar).
- `/invoyslar` sahifasi: **qoladi** (pochta 2 060 000, case'siz).

## Domain (mavjud holat)

- Mijoz = `Loan`'larni **pinfl** bo'yicha guruhlash (alohida Client modeli yo'q).
  Firma bog'lanishi: `Loan.branchCode == Firm.code`.
- `ArizaCase` — markaziy tugun: `firmId` (FK→Firm), `pinfl` (string), `snapshotId`,
  `receiptNumber`/`invoiceNo` (string), `batchId`→InvoiceBatch, `stage` (CaseStage).
- BOJ qadami = `INVOICE_CREATED` + `INVOICE_PAID`. Case unga `SIGNED_SCANNED` dan kiradi.
- Firma bog'lanishi REST tomonida allaqachon bor (`InvoiceRestBatch.firmId`,
  `InvoiceRecord.firmId`). Yetishmayotgani — **invoice→case** bog'lanishi.

## Schema (1 migratsiya)

```prisma
model InvoiceRecord {
  ...
  caseId Int?
  case   ArizaCase? @relation(fields: [caseId], references: [id])
  @@index([caseId])
}
model ArizaCase {
  ...
  invoiceRecords InvoiceRecord[]
}
```
DDL: `ALTER TABLE InvoiceRecord ADD COLUMN caseId INT NULL + INDEX + FK→ArizaCase(id) ON DELETE SET NULL`.

## Komponentlar

### `src/lib/invoice-rest.ts`
- `buildRestPayload(firm, opts?: { amount?: number })` — `amount` parametr, default 2 060 000
  (pochta). Boji uchun `getBojiAmount()` beriladi. `payCategoryId: 3` va qolgani o'zgarmas.
- Umumiy runner ajratiladi (`runRestBatch`) — concurrency + guruh pauza + progress + DB
  sinxron. `startRestBatch` (firma-count, pochta) va yangi `startRestBatchForCases`
  ikkalasi shundan foydalanadi (DRY).
- `startRestBatchForCases({ firmId, snapshotId, count }): { restBatchId, invoiceBatchId, total }`:
  1. Case tanlash: `stage='SIGNED_SCANNED', receiptNumber=null, firmId, [snapshotId]`,
     `orderBy id asc, take count`. Bo'sh bo'lsa `total:0`.
  2. `amount = getBojiAmount()`, `payload = buildRestPayload(firm, { amount })`.
  3. Farmoyish uchun `InvoiceBatch` yaratiladi (mavjud farmoyish/tarix UI ishlashi uchun).
  4. Progress uchun `InvoiceRestBatch` yaratiladi.
  5. Fon: har case uchun token → createInvoiceRest → downloadPdf, so'ng tranzaksiyada:
     `InvoiceRecord.upsert{ caseId, restBatchId, firmId, invoiceNo, amount, pdf }` +
     `ArizaCase.updateMany({ id, receiptNumber:null }, { receiptNumber, invoiceNo,
     batchId, stage:'INVOICE_CREATED', stageEnteredAt, dueAt })` (guard bilan).
  6. Tugagach `InvoiceBatch.createdCount=ok`, `InvoiceRestBatch.phase=DONE`.

### API
- `POST /konveyer/invoice-batch` — endi **REST case batch** boshlaydi (`startRestBatchForCases`),
  `{ restBatchId, invoiceBatchId, total }` qaytaradi (async). GET (progress+history) o'zgarmaydi.
- Progress polling: mavjud `GET /api/invoices/batch/[id]` (restBatchId).

### UI — `BuxgalterPanel.tsx` (FirmRow)
- "Yarat" → POST → `{restBatchId, invoiceBatchId, total}`. `total===0` bo'lsa
  "Imzodan o'tgan case yo'q" xabari.
- restBatchId bo'yicha `/api/invoices/batch/[id]` poll qilinadi — jonli sanoq/progress
  (mavjud InvoiceRestBatch progress shakli). DONE bo'lgach `onDone()` + farmoyish
  havolasi (`invoiceBatchId`).

## Test
- `buildRestPayload(firm, { amount: 20600 })` → amount 20 600, payCategoryId 3, qolgani o'zgarmas.
- Case tanlash filtri: faqat `SIGNED_SCANNED` + `receiptNumber=null`.
- (mavjud) `buildRestPayload` default amount 2 060 000 saqlanadi.

## Xavf/eslatma
- Boji billing invoice `payCategoryId:3` + amount 20 600 bilan yaratiladi (foydalanuvchi
  tasdiqlagan). Agar billing bu summani rad etsa — jonli sinovda ko'rinadi, faqat amount/kategoriya sozlanadi.
- Soxta raqamli eski case'lar o'zgarmaydi.
