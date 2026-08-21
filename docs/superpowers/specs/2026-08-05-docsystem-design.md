# Docsystem — Design Spec

**Date:** 2026-08-05
**Status:** Approved (brainstorming) → ready for implementation planning
**Location:** `/Users/khurshid28/Desktop/apps/docsystem` (own git repo, standalone)

## Xulosa (Uzbek)

Docsystem — ichki vosita: mikromoliya tashkilotlarining **portfel Excel**ini (Ensaydan) yuklaydi,
har kunlik snapshot qilib saqlaydi, va har kredit uchun **sanoat-palatasi arizasini `.docx`**
(QR'siz) qilib chiqaradi. Bitta admin login/parol bilan kiradi. Eksport `sana/ism pinfl/firma/ldid
ism.docx` papka daraxti bilan ZIP bo'lib yuklab olinadi. UI to'liq **qrsystem (spravka)** dizayn
tizimidan nusxalanadi.

---

## 1. Purpose & scope

An internal, single-operator tool that turns a bulk loan **portfolio Excel** (exported from the
"Ensay" accounting system) into individual **court petitions** («Savdo-sanoat palatasiga ariza / Sud
buyrugʻi berish haqida»), one `.docx` per loan, produced in bulk and downloaded as a folder-tree ZIP.

In scope:
- Single admin authentication.
- Upload a portfolio `.xlsx` for a given date → stored as a dated **snapshot** (128k loan rows).
- Calendar of loaded snapshot dates; browse a snapshot with search + aggregation.
- Per-PINFL aggregation (a person's loans across firms, total debt).
- Generate the chamber ariza as `.docx` per loan (no QR), filled from portfolio data.
- Filtered bulk export → ZIP with the required folder tree.
- Firms registry (rekvizit needed by the ariza), seeded from the firm-code table.

Out of scope (YAGNI): the spravka multi-role approval workflow (draft→admin→rahbar→sign), QR
verification, public verification pages, E-IMZO signing, per-debtor court auto-derivation.

## 2. Data source — the portfolio Excel

Analyzed `портфель 09.07 (2).xlsx` (110 MB):

- **Two sheets.** The real one is `портфель 09 (2)`: **106 columns, 128 377 data rows**. The second
  sheet `портфель 09` is a broken CSV-in-one-column dump (Windows-1251 mojibake) — **ignored**.
- **One report date per file:** every row has `date_rep = 2026-07-09`. One file = one daily snapshot.
- **5 firms present** (by `branch` code): 12842 (52 032 rows), 55890 (42 128), 06292 (24 231),
  14276 (9 635), 05557 (351). The firm-code table lists 9 firms; only these 5 appear in this file.
- **51 856 distinct PINFLs.** 13 276 appear in >1 firm; 22 180 have >1 loan. Per-PINFL aggregation
  across firms is real (e.g. one PINFL with 25 loans across 3 firms).
- **Parsing is slow:** openpyxl read the file in ~2m47s. Import MUST be a background job, not a
  request handler.

### Columns consumed (curated subset of the 106)

| Concept | Excel column(s) |
|---|---|
| Person PINFL | `pinfl` |
| Passport | `passport_sn` |
| Full name | `client_name` |
| Phone | `phone_mobile` |
| Postal address | `post_address` |
| Region (Cyrillic) | `name` |
| Firm code | `branch` (== `branch_nam`) |
| Loan id / contract no. | `ld_id` |
| Account | `account` |
| Credit amount | `summ_kr` |
| Yearly rate | `rate` |
| Contract date | `date_to_cr` |
| Close date | `date_close` |
| Report/snapshot date | `date_rep` |
| Class / status | `klass_name`, `status_name` |
| Term type | `term_type` |
| **Debt: principal balance** | `summ_ost_ze` |
| **Debt: term interest** | `sumproc_eqv` |
| **Debt: overdue principal** | `summ_ostpr_ze` |
| **Debt: overdue interest** | `sumnachpr_eqv` |

**Total debt (umumiy qarzdorlik) = `summ_ost_ze + summ_ostpr_ze + sumproc_eqv + sumnachpr_eqv`.**
The Ensay account codes the user mentioned (14801, 12405, 16309, 16377) are context only — not stored
or used. Other balance columns (`ost_17`, `ost_48`, …) are deliberately **excluded** (they would
double-count / are memorandum accounts).

## 3. The generated document — ariza `.docx`

A 1:1 replica of the spravka `CourtArizaDocument` (chamber letterhead petition), Latin Uzbek, Times
New Roman, A4 — **rendered as a real `.docx`** with the `docx` library, **with the QR removed**.

- **On-screen preview:** the copied `CourtArizaDocument` React component (no `qrDataUrl`), so the
  admin sees exactly what the ariza looks like before exporting.
- **Export artifact:** a `.docx` authored by a single `buildArizaDocx(data)` function, driven by the
  same field-mapping as the preview so the two never diverge.

### Field mapping (portfolio row → ariza)

| Ariza field | Source |
|---|---|
| Qarzdor F.I.O. | `client_name` |
| Manzil | `post_address` |
| JShShIR | `pinfl` |
| Tel | `phone_mobile` |
| Shartnoma № / sana | `ld_id` / `date_to_cr` |
| Foiz (%) | `rate` |
| Kredit summasi (loanAmount) | `summ_kr` |
| «…holatiga koʻra» (asOfDate) | `date_rep` |
| Asosiy qarz qoldigʻi | `summ_ost_ze` |
| Muddatli foizlar qarzdorligi | `sumproc_eqv` |
| Muddati oʻtgan qarz qarzdorligi | `summ_ostpr_ze` |
| Muddati oʻtgan foizlar qarzdorligi | `sumnachpr_eqv` |
| Jami qarzdorligi (debtTotal) | sum of the four |
| Undiruvchi firma (name, X/R, MFO, STIR, address) | `Firm` row by `branch` |
| Arizachi / palata block / attachments / signer | fixed `CHAMBER` + `CHAMBER_SIGNER` constants (copied) |

**Not in the portfolio — from Settings (global, editable):**
- `courtName` — default «Fuqarolik ishlari boʻyicha Uchtepa tumanlararo sudiga». Single global default
  applied to every ariza (per-debtor court derivation from region is a future enhancement).
- `contractType` — default «ONLAYN».
- Register `number` and `issueDate` — **left blank** by default (as the physical blank is filled by
  hand). Optional running auto-number is a future toggle, off for MVP.

## 4. Architecture & stack

Standalone app, mirroring spravka's stack so the UI copies cleanly:

- **Next.js 14 (App Router) + TypeScript + Tailwind**, Node 22.
- **Prisma + MySQL 8**.
- Auth: **jose (JWT session cookie) + bcryptjs**, single seeded admin.
- **Docker Compose** deploy (app + mysql), same shape as spravka's `deploy/`.
- New dependencies: **`exceljs`** (streaming xlsx read), **`docx`** (author Word files),
  **`archiver`** (stream a ZIP).

### UI reuse (from qrsystem/spravka)

Copy the spravka design system verbatim into `src/` of the new app: `globals.css`, Tailwind config +
tokens, `AppShell`, `Table`/`components`, `Field`, `Filters`, `Pagination`, `Calendar`, `Select`,
`Modal`, `Charts`, icons, and the ariza pieces (`CourtArizaDocument` minus QR, `chamber-emblem.data`,
`CHAMBER`/`CHAMBER_SIGNER` constants, the money/date formatters from `core/document`). The A4 sheet
CSS (`.cert-sheet` etc.) comes with `globals.css`.

## 5. Data model (Prisma)

- **Admin** — `id, username, passwordHash`. One seeded row.
- **Firm** — `id, code (unique, e.g. "12842"), shortName, legalName, address, bankAccount (X/R), mfo,
  stir, postIndex, phone`. Seeded from the 9-firm code table; full rekvizit filled in the UI
  (Bright Future pre-seeded from the sample).
- **Snapshot** — `id, reportDate (unique), sourceFileName, status (IMPORTING|READY|FAILED),
  rowCount, processedRows, totalDebt, importedAt`. One per uploaded portfolio date.
- **Loan** — `id, snapshotId → Snapshot, pinfl, passportSn, clientName, phone, postAddress,
  regionName, branchCode, ldId, account, summKr, rate, dateToCr, dateClose, klassName, statusName,
  termType, debtPrincipal (summ_ost_ze), debtTermInterest (sumproc_eqv), debtOverduePrincipal
  (summ_ostpr_ze), debtOverdueInterest (sumnachpr_eqv), totalDebt`. Indexes:
  `(snapshotId)`, `(snapshotId, pinfl)`, `(snapshotId, branchCode)`, `(snapshotId, clientName)`.
  ~128k rows per snapshot.
- **Job** — `id, type (IMPORT|EXPORT), status (PENDING|RUNNING|DONE|FAILED), progress, total,
  message, resultPath (zip), params (json), snapshotId, createdAt`. Drives progress polling.

## 6. Flows

1. **Import.** Admin picks the `.xlsx` → the app peeks the first data row and the filename to
   **auto-detect the snapshot date** (from `date_rep`, and the `09.07`-style date in the filename as a
   fallback) and pre-fills a **date field** in the import form. The admin **confirms or changes** this
   date (it is the snapshot's key — always selectable, never silently forced). On start, the file is
   saved, a `Snapshot` (IMPORTING) + `Job` (IMPORT) are created, the API returns immediately. A
   background task streams sheet 1 with `exceljs`, maps the curated columns, computes `totalDebt`,
   batch-inserts (~1000/tx) into `Loan`, updates `Job.progress` and `Snapshot.processedRows`. On
   finish → `Snapshot.status = READY`. UI polls the `Job`. The chosen date is `Snapshot.reportDate`
   (unique); if a snapshot for that date already exists, the UI warns and re-import **replaces** it.
2. **Calendar.** Loaded snapshot dates shown on a month calendar (reuse spravka `Calendar`). Click a
   date → snapshot view.
3. **Snapshot (portfolio) view.** Server-side paginated + searchable table (by `pinfl`, name, firm),
   summary stats (total debt, #loans, #people, per-firm breakdown chart).
4. **Person view.** One PINFL: their loans grouped by firm, per-loan debt + aggregated total, each
   loan links to an **ariza preview** and a single-loan `.docx` download.
5. **Export.** Filter form (date required; firm and/or single person optional) → `Job` (EXPORT)
   created, API returns. Background task iterates the matching loans, calls `buildArizaDocx`, streams
   each into an `archiver` ZIP at path
   `${DD.MM.YY}/${clientName} ${pinfl}/${firmShortName}/${ldId} ${clientName}.docx`,
   writes the ZIP to disk, sets `Job.resultPath`. UI polls, then offers a download link.

### Background-job approach (trade-off)

- **Chosen:** in-process background tasks with a `Job` row + UI polling. Single admin, low
  concurrency, no Redis/BullMQ. Kicked off from a Node-runtime route that returns before the work
  finishes; the long-running `next start` process carries it to completion.
- **Alternative (future):** a separate `worker` compose service polling the `Job` table — the escape
  hatch if imports need to survive app restarts or run concurrently. Not built for MVP.

## 7. Pages

`/login` · `/` (calendar + upload) · `/import` (upload + **date field auto-filled from the file,
editable** + progress) · `/s/[date]` (portfolio table +
stats) · `/s/[date]/p/[pinfl]` (person + ariza preview) · `/export` (filter + job progress +
download) · `/firms` (rekvizit CRUD) · `/settings` (default court, contract type, chamber signer).

## 8. Seeds

- One admin (username/password; the actual password set by the user at deploy — never committed).
- 9 firms from the code table (code + short name + post index 100174); Bright Future's full rekvizit
  pre-filled from the sample ariza.
- Optional: a sample snapshot import for local dev (the provided xlsx), behind a dev-only script.

## 9. Build order (phases)

1. **Foundation** — scaffold Next14 app, copy spravka design system, Tailwind/globals, auth (login +
   session + single admin seed), Prisma schema + migrate, Firm seed, AppShell nav.
2. **Import** — upload UI, streaming `exceljs` import as a background `Job`, `Snapshot` + `Loan`
   persistence, progress polling, calendar of dates.
3. **Browse** — snapshot table (server pagination + search), summary stats, person view, ariza HTML
   preview (copied `CourtArizaDocument`, no QR), single-loan `.docx` download.
4. **Export** — `buildArizaDocx`, filtered bulk export `Job`, `archiver` ZIP folder tree, download.

Each phase ends with the dev server running so the user can see it.

## 10. Open defaults locked in this spec

- Total debt formula = sum of the 4 debt columns (confirmed by user).
- UI = copied from qrsystem/spravka (confirmed).
- Export = filtered/selectable scope (confirmed).
- Court name = single global Settings default, editable; not auto-derived per debtor (MVP).
- Ariza number/date = blank by default (auto-number is a future toggle).
- Contract type default = «ONLAYN».
- Import snapshot date = **selectable** in the import form, auto-filled from the file (`date_rep` /
  filename) and editable by the admin before importing.
