# Docsystem Plan 3 — Browse, Filters & Ariza Preview

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. `- [ ]` steps.

**Goal:** Browse a snapshot — a searchable, filterable, paginated loan table with summary stats; a
per-person view aggregating debt across firms; and an on-screen ariza preview (chamber blank, no QR)
built from a loan.

**Architecture:** Pure query-param → Prisma-where filter module (testable). Server components paginate
via Prisma. A pure `loanToAriza(loan, firm, settings)` maps a Loan to `CourtArizaDocument` props —
shared later by Plan 4's `.docx`. A tiny Settings table holds the ariza's non-portfolio defaults.

**Tech Stack:** Prisma + Next 14 server components + copied spravka `Filters`/`Table`/`Pagination`/
`CourtArizaDocument`.

## Global Constraints

- Total debt = `summ_ost_ze + summ_ostpr_ze + sumproc_eqv + sumnachpr_eqv` (already stored as
  `Loan.totalDebt`).
- Filters (user-requested): by **firm** (`branchCode`), by **PINFL**, by **other** (client name, ld_id),
  by **total debt > X** (`minDebt`), and **by date** (`fromDate` — exclude loans whose contract date
  `dateToCr` is earlier). Empty filter = no constraint.
- Ariza preview = the copied `CourtArizaDocument` with **no `qrDataUrl`**. Non-portfolio fields
  (court name, contract type, chamber signer) come from **Settings** (defaults: court «Fuqarolik
  ishlari boʻyicha Uchtepa tumanlararo sudiga», contractType «ONLAYN», signer from `CHAMBER_SIGNER`).
- Firm block (undiruvchi rekvizit) comes from the `Firm` row matched by `branchCode`.
- Server-side pagination (128k rows — never load all). Page size 50.

---

### Task 1: Settings model + accessor

**Files:** Modify `prisma/schema.prisma`; Create `src/lib/settings.ts`; Test `src/lib/settings.test.ts`.

- [ ] **Step 1** Add a single-row-style key/value Settings model:
```prisma
model Setting {
  key   String @id
  value String @db.Text
}
```
- [ ] **Step 2** `npx prisma db push` + `generate`.
- [ ] **Step 3** `src/lib/settings.ts`: `getSettings()` returns `{ courtName, contractType,
  signerPosition, signerName, executorName, executorPhone }` reading Setting rows, falling back to
  defaults (court «Fuqarolik ishlari boʻyicha Uchtepa tumanlararo sudiga», contractType «ONLAYN», and
  the four signer fields from `CHAMBER_SIGNER` in `@/core/chamber`). `setSetting(key,value)` upserts.
- [ ] **Step 4** Test: default when empty; upsert then read overrides default; clean up rows. PASS.
- [ ] **Step 5** Commit `feat: settings model + accessor`.

---

### Task 2: Filter module (query params ↔ Prisma where) — TDD

**Files:** Create `src/core/loan-filters.ts`; Test `src/core/loan-filters.test.ts`.

**Interfaces — Produces:**
- `parseLoanFilters(sp: Record<string,string|undefined>): LoanFilters` where `LoanFilters =
  { q?, branch?, minDebt?, fromDate?, page }`.
- `buildLoanWhere(snapshotId: number, f: LoanFilters): Prisma.LoanWhereInput`.
- `loanPageHref(base: string, f: LoanFilters, patch: Partial<LoanFilters>): string`.

- [ ] **Step 1 (RED)** Test:
```ts
import { describe, it, expect } from 'vitest';
import { parseLoanFilters, buildLoanWhere } from './loan-filters';
it('parses and defaults page', () => {
  expect(parseLoanFilters({ q: 'ali', branch: '12842', minDebt: '1000000' }))
    .toEqual({ q: 'ali', branch: '12842', minDebt: 1000000, fromDate: undefined, page: 1 });
});
it('builds where with q across pinfl/name/ldId, branch, minDebt, fromDate', () => {
  const w = buildLoanWhere(5, { q: 'ali', branch: '12842', minDebt: 1000000, fromDate: '2026-01-01', page: 1 });
  expect(w.snapshotId).toBe(5);
  expect(w.branchCode).toBe('12842');
  expect(w.totalDebt).toEqual({ gte: 1000000 });
  expect(w.dateToCr).toEqual({ gte: new Date('2026-01-01') });
  expect(Array.isArray(w.OR)).toBe(true); // pinfl/clientName/ldId contains
});
it('empty filters → only snapshotId', () => {
  expect(buildLoanWhere(5, { page: 1 })).toEqual({ snapshotId: 5 });
});
```
- [ ] **Step 2 (RED run)** FAIL.
- [ ] **Step 3 (GREEN)** Implement: `q` → `OR: [{pinfl:{contains:q}},{clientName:{contains:q}},{ldId:{contains:q}}]`;
  `branch`→`branchCode`; `minDebt`→`totalDebt:{gte}`; `fromDate`→`dateToCr:{gte:new Date}`; omit empties.
- [ ] **Step 4 (GREEN run)** PASS. **Step 5** Commit `feat: loan filter parse/where`.

---

### Task 3: Snapshot browse page (table + filters + stats)

**Files:** Create `src/app/(app)/s/[date]/page.tsx`, `src/app/(app)/s/[date]/LoanFilters.tsx` (client).

- [ ] **Step 1** Page (server, `dynamic='force-dynamic'`): resolve snapshot by `reportDate=date`
  (404 if none). Read `searchParams` → `parseLoanFilters` → `buildLoanWhere`. Query in parallel:
  `prisma.loan.findMany({ where, skip:(page-1)*50, take:50, orderBy:{totalDebt:'desc'} })`,
  `prisma.loan.count({ where })`, and stats: `prisma.loan.aggregate({ where, _sum:{totalDebt:true} })`,
  distinct pinfl count, and per-firm `groupBy(branchCode, _count, _sum totalDebt)`.
- [ ] **Step 2** Render: `PageHeader` (date), `StatCard`s (Jami qarz, Kreditlar, Odamlar), a per-firm
  `HBarChart` or table (firm name via a `Firm` map), the `LoanFilters` bar, a `Table` of loans
  (PINFL, F.I.O., Firma, Shartnoma, Qarz — formatted with `formatSumDecimal`) where each row links to
  the person view `/s/{date}/p/{pinfl}`, and `Pagination` using `loanPageHref`.
- [ ] **Step 3** `LoanFilters.tsx` (client): text search (q), firm `Select` (from firms passed in),
  a «Qarz ≥» number input (minDebt), a «Sanadan» date input (fromDate); on change updates the URL
  querystring (router.push) — mirrors spravka `Filters` behavior.
- [ ] **Step 4** Verify `npm run build` clean. Live check (controller) against snapshot 2026-07-09.
- [ ] **Step 5** Commit `feat: snapshot browse page with filters + stats`.

---

### Task 4: Ariza mapping (loan → CourtArizaDocument props) — TDD

**Files:** Create `src/core/ariza.ts`; Test `src/core/ariza.test.ts`.

**Interfaces — Produces:**
- `loanToAriza(loan, firm, settings): CourtArizaDocumentProps` (minus `edit`/`qrDataUrl`). Maps:
  personFullName=clientName, personAddress=postAddress, personPinfl=pinfl, personPhone=phone,
  contracts=[{number:ldId, date:dateToCr}], contractType=settings.contractType, interestRate=String(rate),
  loanAmount=String(summKr), asOfDate=snapshot.reportDate, debtPrincipal=String(debtPrincipal),
  debtTermInterest=String(debtTermInterest), debtOverduePrincipal=String(debtOverduePrincipal),
  debtOverdueInterest=String(debtOverdueInterest), debtTotal=String(totalDebt),
  courtName=settings.courtName, chamber signer fields from settings, `firm` = the CertFirm shape from
  the Firm row (arizaName=legalName||shortName, arizaAddress=address, bankAccount, mfo, stir),
  number='' , issueDate=snapshot.reportDate.

- [ ] **Step 1 (RED)** Test: given a fake loan+firm+settings, assert key props map correctly
  (personFullName, contracts[0].number===ldId, debtTotal===String(totalDebt), firm.arizaName,
  courtName from settings). FAIL.
- [ ] **Step 2 (GREEN)** Implement `loanToAriza`. **Step 3** PASS. **Step 4** Commit `feat: loan→ariza mapping`.

---

### Task 5: Person view + ariza preview

**Files:** Create `src/app/(app)/s/[date]/p/[pinfl]/page.tsx`,
`src/app/(app)/s/[date]/p/[pinfl]/ArizaPreview.tsx`.

- [ ] **Step 1** Page (server): load all loans for `(snapshotId, pinfl)`, the matching firms map, and
  `getSettings()`. Render person header (name, PINFL, address, phone), an aggregated total across all
  their loans, and a per-loan list grouped by firm (firm name, ld_id, contract date, total). Each loan
  has a «Ariza koʻrish» toggle and a «.docx» button (the docx endpoint is Plan 4 — button may link to
  `/api/ariza/{loanId}.docx`, wired in Plan 4).
- [ ] **Step 2** `ArizaPreview.tsx`: given a loan+firm+settings (serializable), call `loanToAriza` and
  render `<div className="cert-frame"><CourtArizaDocument {...props} /></div>` (the A4 sheet CSS is in
  globals.css). No QR. This is the exact page that becomes the `.docx` in Plan 4.
- [ ] **Step 3** Verify `npm run build` clean; live-check one person on 2026-07-09 renders a full ariza.
- [ ] **Step 4** Commit `feat: person view + ariza preview`.

---

## Self-review notes
- Spec coverage: §3 preview → T4/T5; §6.3 browse+filters → T2/T3; §6.4 person → T5; settings → T1.
- `loanToAriza` (T4) is deliberately shared with Plan 4 (docx) so preview and export never diverge.
- Filters honor the user's list: firm, PINFL, name/ld_id (q), total-debt≥X, contract-date≥fromDate.
