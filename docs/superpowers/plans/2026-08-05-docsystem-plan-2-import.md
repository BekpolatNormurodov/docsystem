# Docsystem Plan 2 — Import

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or executing-plans. Steps use `- [ ]` checkboxes.

**Goal:** Upload a portfolio `.xlsx` for an admin-selected date → stream-parse it in the background
(128k rows) → persist per-loan rows (curated columns + the full raw row) + a Snapshot, with live
progress — and a calendar of loaded dates.

**Architecture:** Snapshot/Loan/Job Prisma models. A pure mapping module turns a raw sheet row into a
Loan and computes total debt. A streaming importer (`exceljs` `WorkbookReader`) batch-inserts and
updates a `Job` row; an API route starts it in-process and returns immediately; the UI polls the Job.

**Tech Stack:** exceljs (streaming) + Prisma + Next 14 route handlers (`runtime='nodejs'`).

## Global Constraints

- **Total debt = `summ_ost_ze + summ_ostpr_ze + sumproc_eqv + sumnachpr_eqv`** (the 4 debt columns).
- Real sheet = the FIRST worksheet whose header row contains `pinfl` (106 columns). Ignore the second
  one-column mojibake sheet.
- **Preserve full client detail:** every Loan stores the complete raw sheet row as JSON, in addition
  to the typed curated columns (user requirement — address and all other fields must survive import).
- Import date is **admin-selectable**, auto-filled from the filename (`DD.MM` / `DD.MM.YY`), editable;
  the chosen date is the Snapshot key. Re-import for an existing date **replaces** that snapshot.
- Import is a **background Job** with progress; the upload response returns immediately and the UI
  shows «bajarilyapti» until done.
- Local dev DB is the running MySQL at `localhost:3306` (`DATABASE_URL` in `.env`). Never commit `.env`.
- Money columns are `Decimal(20,2)`; `rate` is `Decimal(6,2)`.

---

### Task 1: Schema — Snapshot, Loan, Job

**Files:** Modify `prisma/schema.prisma`; Test: `src/lib/schema.test.ts`

- [ ] **Step 1** Add models (keep existing Admin, Firm):

```prisma
model Snapshot {
  id             Int      @id @default(autoincrement())
  reportDate     DateTime @unique @db.Date
  sourceFileName String
  status         String   @default("IMPORTING") // IMPORTING | READY | FAILED
  rowCount       Int      @default(0)
  processedRows  Int      @default(0)
  totalDebt      Decimal  @default(0) @db.Decimal(30, 2)
  importedAt     DateTime @default(now())
  loans          Loan[]
}

model Loan {
  id                   Int      @id @default(autoincrement())
  snapshotId           Int
  snapshot             Snapshot @relation(fields: [snapshotId], references: [id], onDelete: Cascade)
  pinfl                String?
  passportSn           String?
  clientName           String?
  phone                String?
  postAddress          String?  @db.Text
  regionName           String?
  branchCode           String?
  ldId                 String?
  account              String?
  summKr               Decimal? @db.Decimal(20, 2)
  rate                 Decimal? @db.Decimal(6, 2)
  dateToCr             DateTime? @db.Date
  dateClose            DateTime? @db.Date
  klassName            String?
  statusName           String?
  termType             String?
  debtPrincipal        Decimal  @default(0) @db.Decimal(20, 2) // summ_ost_ze
  debtTermInterest     Decimal  @default(0) @db.Decimal(20, 2) // sumproc_eqv
  debtOverduePrincipal Decimal  @default(0) @db.Decimal(20, 2) // summ_ostpr_ze
  debtOverdueInterest  Decimal  @default(0) @db.Decimal(20, 2) // sumnachpr_eqv
  totalDebt            Decimal  @default(0) @db.Decimal(20, 2)
  raw                  Json     // the complete sheet row, header->value (full client detail)

  @@index([snapshotId])
  @@index([snapshotId, pinfl])
  @@index([snapshotId, branchCode])
  @@index([snapshotId, clientName])
  @@index([snapshotId, totalDebt])
}

model Job {
  id         Int      @id @default(autoincrement())
  type       String   // IMPORT | EXPORT
  status     String   @default("PENDING") // PENDING | RUNNING | DONE | FAILED
  progress   Int      @default(0)
  total      Int      @default(0)
  message    String?  @db.Text
  resultPath String?
  params     Json?
  snapshotId Int?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}
```

- [ ] **Step 2** Push: `npx prisma db push` → "in sync"; `npx prisma generate`.
- [ ] **Step 3** Test `src/lib/schema.test.ts`: create a Snapshot + a Loan (with `raw: { a: 1 }`) +
  a Job, read them back, assert fields (incl. `raw`), then delete. `import 'dotenv/config'` not
  needed (vitest.config already loads it). Run `npx vitest run src/lib/schema.test.ts` → PASS.
- [ ] **Step 4** Commit: `feat: Snapshot/Loan/Job schema`.

---

### Task 2: Pure mapping + total-debt + date helpers (TDD)

**Files:** Create `src/core/portfolio.ts`; Test: `src/core/portfolio.test.ts`

**Interfaces — Produces:**
- `PORTFOLIO_COLUMNS: string[]` — the 106 header names (from the spec's column list).
- `computeTotalDebt(r: Record<string, unknown>): number` — sum of the 4 debt columns.
- `mapRowToLoan(header: string[], values: unknown[]): LoanInput` where `LoanInput` has the typed Loan
  fields (minus id/snapshotId) plus `raw: Record<string, unknown>` (header→value of the whole row).
- `parseDateFromFilename(name: string): string | null` — returns `YYYY-MM-DD` or null. Accepts
  `DD.MM.YY`, `DD.MM.YYYY`, `DD.MM` (DD.MM → current year is the caller's job; here return null if no
  year) — actually: parse `DD.MM.YY`/`DD.MM.YYYY` to ISO; for bare `DD.MM` return `--MM-DD` sentinel?
  Keep it simple: return `{ day, month, year? }` object instead. Define `parseDateParts(name)`.

- [ ] **Step 1 (RED)** Write `src/core/portfolio.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeTotalDebt, mapRowToLoan, parseDateParts } from './portfolio';

describe('computeTotalDebt', () => {
  it('sums the four debt columns', () => {
    expect(computeTotalDebt({
      summ_ost_ze: 100, sumproc_eqv: 20, summ_ostpr_ze: 3, sumnachpr_eqv: 4, ost_17: 999,
    })).toBe(127); // ost_17 excluded
  });
  it('treats blanks/nulls as 0', () => {
    expect(computeTotalDebt({ summ_ost_ze: 100, sumproc_eqv: '', summ_ostpr_ze: null })).toBe(100);
  });
});

describe('mapRowToLoan', () => {
  const header = ['pinfl','client_name','branch','ld_id','summ_ost_ze','sumproc_eqv','summ_ostpr_ze','sumnachpr_eqv','post_address'];
  const values = ['123','AAA BBB','12842','2244',100,20,3,4,'Some address'];
  it('maps typed fields and total', () => {
    const l = mapRowToLoan(header, values);
    expect(l.pinfl).toBe('123');
    expect(l.clientName).toBe('AAA BBB');
    expect(l.branchCode).toBe('12842');
    expect(l.ldId).toBe('2244');
    expect(l.debtPrincipal).toBe(100);
    expect(l.totalDebt).toBe(127);
    expect(l.postAddress).toBe('Some address');
  });
  it('keeps the full row in raw', () => {
    const l = mapRowToLoan(header, values);
    expect(l.raw.post_address).toBe('Some address');
    expect(Object.keys(l.raw)).toHaveLength(header.length);
  });
});

describe('parseDateParts', () => {
  it('parses DD.MM.YY', () => {
    expect(parseDateParts('портфель 09.07.26 (2).xlsx')).toEqual({ day: 9, month: 7, year: 2026 });
  });
  it('parses bare DD.MM with no year', () => {
    expect(parseDateParts('портфель 09.07 (2).xlsx')).toEqual({ day: 9, month: 7, year: null });
  });
  it('returns null when no date', () => {
    expect(parseDateParts('portfel.xlsx')).toBeNull();
  });
});
```

- [ ] **Step 2 (RED run)** `npx vitest run src/core/portfolio.test.ts` → FAIL (module missing).
- [ ] **Step 3 (GREEN)** Implement `src/core/portfolio.ts`:
  - `PORTFOLIO_COLUMNS` = the 106 names in order (copy from the spec column list / analysis).
  - `num(v)` helper: `Number` if finite else 0 (handles '', null, numeric strings).
  - `computeTotalDebt` = num(summ_ost_ze)+num(summ_ostpr_ze)+num(sumproc_eqv)+num(sumnachpr_eqv).
  - `mapRowToLoan`: build `raw` from header→values; pull typed fields by name; dates via `new Date`
    when the value is a Date/parseable, else null; `Decimal`-bound numbers stay JS numbers here
    (Prisma accepts number for Decimal). Return `LoanInput`.
  - `parseDateParts(name)`: regex `/(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?/`; map to {day,month,year}
    (2-digit year → 2000+yy); year null if absent.
- [ ] **Step 4 (GREEN run)** `npx vitest run src/core/portfolio.test.ts` → PASS.
- [ ] **Step 5** Commit: `feat: portfolio row mapping + total-debt + date parse`.

---

### Task 3: Streaming importer (exceljs) with a generated fixture

**Files:** Create `src/lib/import-portfolio.ts`, `src/lib/make-fixture.ts` (test helper);
Test: `src/lib/import-portfolio.test.ts`

**Interfaces — Produces:**
- `importPortfolio(filePath: string, snapshotId: number, onProgress?: (n:number)=>void): Promise<{rows:number,totalDebt:number}>`
  — streams the first pinfl-bearing worksheet, maps rows via `mapRowToLoan`, inserts Loans in batches
  of 1000 with `prisma.loan.createMany`, updates `Snapshot.processedRows/totalDebt` periodically,
  returns totals. Add `exceljs` to dependencies.

- [ ] **Step 1** Add dep: `npm i exceljs`.
- [ ] **Step 2 (RED)** `make-fixture.ts`: uses `exceljs` to WRITE a tiny 2-sheet xlsx to a temp path
  (sheet 1 = header + 3 data rows mirroring real column names incl. the 4 debt cols + a decoy sheet 2
  with one column). Test creates a Snapshot, runs `importPortfolio`, asserts 3 Loans inserted, their
  `totalDebt` correct, `raw` populated, and the decoy sheet ignored. Run → FAIL.
- [ ] **Step 3 (GREEN)** Implement `importPortfolio`:
  - `const workbook = new Excel.stream.xlsx.WorkbookReader(filePath, { worksheets: 'emit', sharedStrings: 'cache', entries: 'emit' });`
  - `for await (const worksheet of workbook)`: capture the first row as header; if header doesn't
    include `pinfl`, skip that worksheet entirely; else treat subsequent rows as data.
  - Accumulate a batch; every 1000 rows `await prisma.loan.createMany({ data: batch })`, bump a
    counter, `onProgress(counter)`, and periodically update the Snapshot. Flush the remainder.
  - Return `{ rows, totalDebt }`.
  - Note: exceljs row `.values` is 1-indexed (index 0 is empty) — normalize to a 0-based array before
    calling `mapRowToLoan`.
- [ ] **Step 4 (GREEN run)** `npx vitest run src/lib/import-portfolio.test.ts` → PASS.
- [ ] **Step 5** Commit: `feat: streaming portfolio importer`.

---

### Task 4: Import API + in-process background runner

**Files:** Create `src/lib/jobs.ts`, `src/app/api/import/route.ts`, `src/app/api/jobs/[id]/route.ts`,
`src/app/api/import/peek/route.ts`; uploads saved under `uploads/` (git-ignored).

**Interfaces:**
- `src/lib/jobs.ts`: `runImportJob(jobId, filePath, snapshotId)` — sets Job RUNNING, calls
  `importPortfolio` with an `onProgress` that updates `Job.progress`, sets Snapshot READY + rowCount
  on success (Job DONE) or FAILED with the error message.
- `POST /api/import` (multipart): fields = file + `date` (YYYY-MM-DD). Saves the upload to `uploads/`,
  upserts a Snapshot for `date` (deleting any existing one's loans first — replace semantics), creates
  an IMPORT Job, **kicks `runImportJob` without awaiting**, returns `{ jobId, snapshotId }` immediately.
  `runtime='nodejs'`, `export const maxDuration` not needed (returns fast).
- `GET /api/jobs/[id]` → `{ status, progress, total, message }`.
- `POST /api/import/peek` (multipart file OR `{ filename }`): returns `parseDateParts(filename)` so the
  UI can prefill the date. (Filename-only peek — no heavy file open.)

- [ ] **Step 1** Write `jobs.ts` (the runner + replace-on-reimport logic).
- [ ] **Step 2** Write the three routes. Add `uploads/` to `.gitignore`.
- [ ] **Step 3** Test `src/app/api/jobs-run.test.ts`: call `runImportJob` directly against a generated
  fixture + a fresh Snapshot/Job; assert Job goes RUNNING→DONE, progress==rows, Snapshot READY. Run → PASS.
- [ ] **Step 4** Commit: `feat: import API + background job runner`.

---

### Task 5: Import page (upload + selectable date + progress)

**Files:** `src/app/(app)/import/page.tsx`, `src/app/(app)/import/ImportForm.tsx` (client).

- [ ] **Step 1** `ImportForm.tsx` (`'use client'`): a `FilePicker` for the `.xlsx`; on file chosen,
  call `/api/import/peek` and prefill a `DateField` (`DD.MM` → today's year if year null), fully
  editable. A «Yuklash» button POSTs multipart (file + date) to `/api/import`, then polls
  `/api/jobs/{id}` every ~1s showing a progress bar + «Bajarilyapti… {progress}/{total}», and «Tayyor»
  with a link to the snapshot when DONE (or the error when FAILED).
- [ ] **Step 2** `import/page.tsx`: `requireAdmin()` + `PageHeader` + `<ImportForm/>`. `dynamic='force-dynamic'`.
- [ ] **Step 3** Verify: `npm run build` clean. (Live upload of the real 106MB file is a controller
  check, not a subagent step.)
- [ ] **Step 4** Commit: `feat: import page with selectable date + progress`.

---

### Task 6: Calendar of loaded dates

**Files:** `src/app/(app)/page.tsx` (replace empty state), `src/app/(app)/calendar-data.ts`.

- [ ] **Step 1** `calendar-data.ts`: `getSnapshotDays()` → `prisma.snapshot.findMany` mapping each to
  the shared `Calendar`'s `DayData` shape (date + a count/label + status). One focused test that it
  returns the right shape for a seeded snapshot.
- [ ] **Step 2** `(app)/page.tsx`: render the shared `Calendar` with those days; a day with a snapshot
  links to `/s/{YYYY-MM-DD}` (the snapshot view is Plan 3 — link may 404 until then, that's fine). If
  no snapshots, keep the empty state + a link to Import.
- [ ] **Step 3** Verify `npm run build` clean + the calendar-data test passes.
- [ ] **Step 4** Commit: `feat: calendar of loaded snapshot dates`.

---

## Self-review notes
- Spec coverage: §2 parsing → T2/T3; §5 Snapshot/Loan/Job → T1; §6.1–6.2 import+calendar → T3–T6;
  full-client-detail (user) → `raw Json` in T1/T2. Filters/browse/export are Plan 3/4.
- Perf: streaming importer + batched inserts keep 128k rows off the request path (background Job).
