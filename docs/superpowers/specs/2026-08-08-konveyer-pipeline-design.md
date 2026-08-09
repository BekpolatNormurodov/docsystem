# Konveyer: talabnoma → sud → MIB — Design Spec

**Sana:** 2026-08-08
**Goal:** URBAN/BRIGHT kabi mikromoliya firmalari uchun qarz undirish konveyerini docsystem ichida to'liq avtomatlashtirish — Excel'dan hujjat generatsiya, xat.hippo'ga yuborish, ariza chop/imzo/skan, davlat boji invoice batch'lari + buxgalteriya farmoyishi, cabinet.sud.uz (adolat) ga topshirish, MIB ijro — hammasi **har firma alohida**, sonlar/etap bo'yicha kuzatiladi.

## Arxitektura
- **docsystem (Next.js 14, Prisma/MySQL)** = UI + API + DB + session egasi (mavjud). Reuse: `import-portfolio`, `talabnoma-pdf`, `ariza-docx`, `hippo/xat`, `cabinet/*`, `ExternalSession`, `CourtFeeInvoice`.
- **RabbitMQ + worker-servislar** (keyingi bloklar): og'ir/uzoq bosqichlar — PDF batch (6000×5), skan-split, tashqi API retry (hippo/sud/MIB). UI/CRUD monolitda qoladi.
- Har bosqich statusni DB'ga yozadi; **Konveyer dashboard** shu bo'yicha sonlarni firma + umumiy ko'rsatadi.

## Case status mashinasi (vaqt-etap)
Har ariza = **bitta mijoz (pinfl) × firma × sikl**. Bosqichlar:
`IMPORTED → TALABNOMA_SENT → ARIZA_GENERATED → PRINTED → SIGNED_SCANNED → INVOICE_CREATED(NOT_PAID) → INVOICE_PAID → COURT_SUBMITTED(adolat) → COURT_ACCEPTED | COURT_RETURNED → MIB_SUBMITTED → CLOSED`

Dashboard funnel misoli: 1054 jami · 120 to'lanmagan · 200 shahar sudida · 300 adolatda · 20 to'lanmagan · 130 MIB'ga chiqqan.

## Packet (adolatga, per-mijoz 5–6+ forma)
Real namuna (AXMEDOVA / BRIGHT):
- **Per-mijoz generatsiya:** talabnoma (`talabnoma-pdf`✓), ariza (`ariza-docx`✓ + imzo skan), davlat boji invoice (`cabinet/billing`✓, 20 600), hippo kvitansiya (`xat`✓).
- **Per-firma statik kutubxona (attach):** guvohnoma, ishonchnoma, shartnoma, oferta(×4). Generatsiya emas — firma bo'yicha bir marta yuklab qo'yiladi.

## Invoice batch + buxgalteriya farmoyishi (har firma alohida)
1. Firma tanlanadi → **max son** (default 100, tugmalar 200/300) → "invoice yarat".
2. N ta boji invoice yaratiladi → kvitansiya raqami olinadi → ariza-case'ga bog'lanadi (progress).
3. Batch tugagach → **buxgalteriya farmoyishi DOCX**: sarlavha (firma, sud nomi, sana, sabab) + jadval `№ | Qarzdor FIO | Kod | Pochta harajati (20 600) | Kvitansiya raqami`.
4. Kvitansiya raqami sudga ariza kiritishда biriktiriladi.

## Nomerlash (jiddiy, logik)
Case bo'yicha uch raqam bir-biriga bog'liq va farmoyish↔invoice↔cabinet uchun bir xil:
- `farmoyish №` — batch ichida 1..N ketma-ket.
- `client kod` — Excel'dan (masalan 60123092).
- `kvitansiya raqami` — billing'dan (262…).

## Build tartibi
A (generatsiya + firma kutubxona + invoice batch + farmoyish + dashboard) → B (chop/imzo) → C (skan-split) → D (adolat yakun + MIB) → Hisobot.

## Prisma modellar (yangi)
- `enum CaseStage` — yuqoridagi bosqichlar.
- `model ArizaCase` — pinfl, clientName, firmId, snapshotId, stage, kod, invoiceNo, receiptNumber, courtCaseId, mibRef, timestamps.
- `model FirmDocument` — firmId, kind (GUVOHNOMA|ISHONCHNOMA|SHARTNOMA|OFERTA), filePath, label.
- `model InvoiceBatch` — firmId, court, requestedCount, createdCount, status, farmoyishPath, createdAt.
