# Docsystem Plan 4 — DOCX Export

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. `- [ ]` steps.

**Goal:** Generate the chamber ariza as a real `.docx` (no QR) — one per loan for download, and a
filtered **bulk export** as a ZIP with the folder tree `sana/ism pinfl/firma/ldid ism.docx`, under a
new **«Hujjatlar»** section.

**Architecture:** `buildArizaDocx(props)` authors a Word file with the `docx` library, mirroring
`CourtArizaDocument`. A single-loan route streams one file; a background export Job streams N files
into an `archiver` ZIP at the required paths.

**Tech Stack:** `docx` (author) + `archiver` (zip) + Next route handlers.

## Global Constraints

- The `.docx` is a 1:1 content replica of `src/ui/CourtArizaDocument.tsx` **with no QR**: chamber
  emblem image at top-left, branch block right; Times New Roman; body 14pt justified, first-line
  indent 1.25cm; the four debt lines; attachments (1cm indent); signer left/name right; ijrochi 10pt.
- Amounts formatted with `formatSumDecimal` (from `@/core/document`). Dates with `dmy`.
- Reuse `loanToAriza(loan, firm, settings, reportDate)` from `@/core/ariza` → the SAME props the
  on-screen preview uses (preview and docx never diverge).
- Firm block from the `Firm` row (arizaName=legalName||shortName, address, X/R, MFO, STIR).
- **Export folder tree (verbatim):** `${DD.MM.YY}/${clientName} ${pinfl}/${firmShortName}/${ldId} ${clientName}.docx`,
  each path segment sanitized (strip `\\ / : * ? " < > |`, collapse spaces).
- Export scope is **filtered** (reuse `buildLoanWhere`): date required; firm / pinfl / minDebt optional.
- Bulk export runs as a background Job (progress); the ZIP is written to `exports/` (git-ignored) and
  downloaded via a link.

---

### Task 1: `buildArizaDocx` (docx author) — TDD

**Files:** Create `src/lib/ariza-docx.ts`; Test `src/lib/ariza-docx.test.ts`. Add dep `docx`.

**Interfaces — Produces:** `buildArizaDocx(props: CourtArizaDocumentProps): Promise<Buffer>`.

- [ ] **Step 1** `npm i docx`.
- [ ] **Step 2 (RED)** Test: build with sample props (like the ui-smoke ariza props), assert the
  Buffer is non-empty and starts with the ZIP magic `PK\x03\x04` (docx is a zip). Then unzip
  `word/document.xml` (with the `docx`/adm-zip or node's zlib via the `docx` Packer output — simplest:
  check the buffer contains the debtor name and «A R I Z A» after `Packer.toBuffer` → convert to
  string and `.includes`? binary; instead unzip document.xml with `unzipSync` from `fflate` if
  available, else assert magic + length > 5000). Keep it simple: assert magic bytes + `buf.length`.
- [ ] **Step 3 (GREEN)** Implement with `docx`: `Document` → one `Section` with children:
  - Header table (2 cols): left cell `ImageRun` from `CHAMBER_EMBLEM_DATA_URL` (decode base64 →
    Buffer; ~20mm high), right cell the branch block (`CHAMBER.branchName` bold + `CHAMBER.contact`
    lines), from `@/core/chamber`.
  - Date line (`arizaHeaderDate(issueDate)` or the raw issueDate), number if present.
  - Court name (bold). Arizachi block (`CHAMBER.applicantName/Address/Stir`). Undiruvchi block
    (`CHAMBER.collectorLabel`, firm name bold, rekvizit line). Qarzdor block (name bold, address,
    `JShShIR:`, `Tel:`).
  - Centered `A R I Z A` + `(Sud buyrugʻi berish haqida)`.
  - Body paragraphs (justified, `indent:{firstLine:709}` twips) with the exact wording from
    `CourtArizaDocument` — inject firm name, contracts (`dmy(date)-yildagi number-sonli`), contractType,
    interestRate, `formatSumDecimal(loanAmount)`, asOf text, and the four debt lines
    (`formatSumDecimal` each) + `Jami … soʻm` bold.
  - `S Oʻ R A Y M I Z:` + the two request paragraphs.
  - Attachments (`CHAMBER.attachments`, 1cm first-line indent).
  - Signature row (position left, name right) + ijrochi block (10pt). NO QR.
  - `return await Packer.toBuffer(doc)`.
- [ ] **Step 4 (GREEN run)** Test PASS. **Step 5** Commit `feat: buildArizaDocx (chamber ariza as .docx, no QR)`.

---

### Task 2: Single-loan `.docx` endpoint

**Files:** Create `src/app/api/ariza/[loanId]/route.ts` (path `/api/ariza/{loanId}.docx` is already
linked from the person view as `/api/ariza/{id}.docx` — match that: use a `[...docx]` or a
`[loanId]` segment that accepts the `.docx` suffix; simplest: route file at
`src/app/api/ariza/[loanId]/route.ts` and have the person link point to `/api/ariza/{id}` — if the
existing link includes `.docx`, add a route that strips it).

- [ ] **Step 1** Confirm the person view link target (it is `/api/ariza/{loanId}.docx`). Create the
  handler so that path resolves: use `src/app/api/ariza/[loanId]/route.ts` and in the person view
  change the link to `/api/ariza/{loanId}` OR keep `.docx` and parse `params.loanId` stripping a
  trailing `.docx`. Pick one and make them consistent.
- [ ] **Step 2** Handler (`runtime='nodejs'`, `requireAdmin()`): load `loan` (by id), its `firm` (by
  branchCode), its `snapshot` (for reportDate), and `getSettings()`; `loanToAriza(...)` →
  `buildArizaDocx(props)` → return the Buffer with headers
  `Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document` and
  `Content-Disposition: attachment; filename="<ldId> <clientName>.docx"` (ASCII-fallback the name).
- [ ] **Step 3** Verify `npm run build` clean; controller live-downloads one file.
- [ ] **Step 4** Commit `feat: single-loan ariza .docx endpoint`.

---

### Task 3: Bulk export — ZIP folder tree + Job

**Files:** Create `src/lib/export-arizas.ts`, `src/lib/export-paths.ts` (+ test),
`src/app/api/export/route.ts`, `src/app/api/export/[jobId]/route.ts`. Add dep `archiver`. `exports/`
git-ignored.

**Interfaces — Produces:**
- `arizaZipPath(reportDate, clientName, pinfl, firmShortName, ldId): string` (pure, tested) →
  `${DD.MM.YY}/${clean(clientName)} ${pinfl}/${clean(firmShortName)}/${clean(ldId)} ${clean(clientName)}.docx`.
- `runExportJob(jobId, filters)` — streams matching loans, builds each docx, appends to an `archiver`
  ZIP at `arizaZipPath(...)`, updates Job.progress, writes to `exports/{jobId}.zip`, sets resultPath.

- [ ] **Step 1 (RED)** `export-paths.test.ts`: `arizaZipPath(new Date('2026-07-09'),'AAA/BBB','123','FIRMA','2244')`
  === `'09.07.26/AAA_BBB 123/FIRMA/2244 AAA_BBB.docx'` (illegal chars sanitized). FAIL → implement → PASS.
- [ ] **Step 2** `export-arizas.ts` `runExportJob`: parse `filters` (snapshotId + `buildLoanWhere`),
  `prisma.loan.findMany` in pages (e.g. 500) to avoid loading 128k at once; for each load its firm
  (cache firms in a Map) + settings (once) + reportDate; `buildArizaDocx` → `archive.append(buf, { name: arizaZipPath(...) })`;
  bump Job.progress per file; finalize archive to `exports/{jobId}.zip`; set Job DONE + resultPath.
  Use `updateMany`/`.catch` like `runImportJob` (never unhandledReject).
- [ ] **Step 3** `POST /api/export` (`requireAdmin`, nodejs): body `{ date, branch?, q?, minDebt? }` →
  resolve snapshot → create EXPORT Job → fire-and-forget `runExportJob(job.id, {...})` → return `{jobId}`.
  `GET /api/export/[jobId]` → `{status, progress, total, resultPath?}`. A `GET /api/export/[jobId]/download`
  (or reuse resultPath) streams the ZIP.
- [ ] **Step 4** A small test for `runExportJob` against a 2-loan fixture snapshot (test DB): asserts
  Job DONE, zip file exists, contains 2 entries. Clean up. PASS.
- [ ] **Step 5** Commit `feat: bulk ariza .docx ZIP export job`.

---

### Task 4: «Hujjatlar» section (export UI)

**Files:** Create `src/app/(app)/hujjatlar/page.tsx`, `.../ExportForm.tsx` (client); add a
«Hujjatlar» nav item in `(app)/layout.tsx`.

- [ ] **Step 1** Add «Hujjatlar» to the AppShell nav (between Import and Firmalar), icon from NAV_ICONS.
- [ ] **Step 2** `hujjatlar/page.tsx` (server, `requireAdmin`, `force-dynamic`): `PageHeader` +
  `<ExportForm firms={...} dates={...}/>` (list snapshot dates + firms for the filter selects).
- [ ] **Step 3** `ExportForm.tsx` (client): selects for sana (required), firma (optional), qidiruv/qarz≥
  (optional) → «ZIP yaratish» POSTs `/api/export`, polls `/api/export/{jobId}` showing «Bajarilyapti…
  {progress}» then a «Yuklab olish» link to the ZIP when DONE.
- [ ] **Step 4** Verify `npm run build` clean; controller live-generates a small filtered ZIP (e.g.
  one firm) and confirms the folder tree.
- [ ] **Step 5** Commit `feat: Hujjatlar export section`.

---

## Self-review notes
- Spec coverage: §3 docx → T1/T2; §6.5 filtered ZIP export → T3; §7 Hujjatlar page → T4.
- `buildArizaDocx` consumes `loanToAriza` output — preview and .docx share one mapping.
- Export scope reuses `buildLoanWhere` (same filters as browse). Folder tree per the user's spec, sanitized.
