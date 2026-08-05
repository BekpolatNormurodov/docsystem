# Docsystem — Implementation Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement each plan task-by-task.

**Goal:** Build Docsystem — a standalone single-admin tool that imports dated portfolio Excel
snapshots and exports per-loan chamber-ariza `.docx` files in a folder-tree ZIP.

**Spec:** `docs/superpowers/specs/2026-08-05-docsystem-design.md`

**Architecture:** Next.js 14 (App Router) app mirroring spravka's stack, so spravka's proven UI and
core utilities copy in directly. In-process background jobs (a `Job` table + UI polling) handle the
slow 128k-row import and the bulk docx export. The ariza is authored as a real `.docx` (no QR) with
the `docx` library, driven by the same field mapping as its on-screen HTML preview.

**Tech Stack:** Node 22 · Next.js 14 · TypeScript · Tailwind · Prisma + MySQL 8 · jose + bcryptjs ·
exceljs · docx · archiver · vitest · Docker Compose.

## Global Constraints

- Node 22; Next.js 14 App Router; TypeScript strict; Tailwind; Prisma + MySQL 8; jose + bcryptjs.
- **Single admin** only. No draft→admin→rahbar→sign approval workflow. No QR, no public verification,
  no E-IMZO.
- **Total debt formula (verbatim):** `totalDebt = summ_ost_ze + summ_ostpr_ze + sumproc_eqv + sumnachpr_eqv`.
  The Ensay account codes (14801, 12405, 16309, 16377) are never stored or used.
- **UI is copied verbatim** from spravka at `C:\Users\JONIBEK\Desktop\spravka\packages\shared\src`
  and `C:\Users\JONIBEK\Desktop\spravka\apps\web-yurist`. Follow spravka's patterns; do not redesign.
- **Ariza** = a 1:1 replica of spravka `CourtArizaDocument`, **with the QR removed** (`qrDataUrl`
  dropped everywhere).
- **Export folder tree (verbatim):**
  `${DD.MM.YY}/${clientName} ${pinfl}/${firmShortName}/${ldId} ${clientName}.docx`.
- **Import date is admin-selectable**, auto-filled from the file (`date_rep` value / `09.07`-style
  filename) and editable before import.
- **Real portfolio sheet** is the first sheet (`портфель 09 (2)` style name); the second one-column
  mojibake sheet is ignored. Column order/names per the spec's column table.
- **Never commit secrets** (DB passwords, admin password, JWT secret) — env only, like spravka.
- New runtime deps beyond spravka's set: `exceljs`, `docx`, `archiver`.

## Plans (sequential; each yields working, testable software)

| Plan | Covers (spec §) | Deliverable |
|---|---|---|
| **1 — Foundation** | §4, §5 (Admin/Firm), §7 shell, §8 firm seed | Running app: login (single admin), copied spravka UI shell, Prisma+MySQL wired, Firm table seeded, `/firms` CRUD, empty authenticated dashboard. |
| **2 — Import** | §2, §5 (Snapshot/Loan/Job), §6.1–6.2 | Upload `.xlsx` + selectable date → background streaming import (exceljs) → `Snapshot`+`Loan` rows, progress polling, calendar of dates. |
| **3 — Browse** | §3 preview, §6.3–6.4, §7 | Snapshot table (server pagination + search), summary stats, person view with per-firm aggregation, ariza HTML preview (no QR), single-loan `.docx` download. |
| **4 — Export** | §3 docx, §6.5, §6 job | `buildArizaDocx`, filtered bulk export `Job`, `archiver` ZIP folder tree, download. |

**Just-in-time:** Only Plan 1 is written in full now. Plans 2–4 are written immediately before each
executes, so they reflect what actually exists after the prior plan lands (spravka's model).

## Spec-coverage traceability

- §1 scope / §10 defaults → constraints above, honored across all plans.
- §2 portfolio parsing → Plan 2.
- §3 ariza document → Plan 3 (preview + single docx) and Plan 4 (bulk docx export).
- §4 architecture/stack + UI reuse → Plan 1.
- §5 data model → Admin/Firm in Plan 1; Snapshot/Loan/Job in Plan 2.
- §6 flows → import Plan 2, browse Plan 3, export Plan 4.
- §7 pages → shell/firms/settings Plan 1; import/calendar Plan 2; snapshot/person Plan 3; export Plan 4.
- §8 seeds → admin+firms Plan 1; sample snapshot (dev script) Plan 2.
- §9 build order = this table.
