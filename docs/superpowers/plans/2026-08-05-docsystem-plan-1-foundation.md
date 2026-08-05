# Docsystem Plan 1 — Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running single-admin Next.js 14 app with the spravka UI copied in, Prisma+MySQL wired,
an admin-protected shell, and a seeded Firm registry with rekvizit CRUD.

**Architecture:** One standalone Next app. Spravka's `packages/shared/src/ui` and `.../core` subsets
are copied under `src/ui` and `src/core` (preserving relative imports), and `apps/web-yurist` is the
template for app config + auth wiring. Auth reuses spravka's tested `password.ts`/`session.ts`.

**Tech Stack:** Next 14.2.18 · React 18.3 · TypeScript 5.6 · Tailwind 3.4 · Prisma 5.22 + MySQL 8 ·
jose 5.9 · bcryptjs 2.4 · vitest 2.1.

## Global Constraints

See the roadmap's Global Constraints — they apply to every task. Key for this plan: single admin only;
UI copied verbatim from spravka (`C:\Users\JONIBEK\Desktop\spravka`); never commit secrets.

**Spravka source root:** `C:\Users\JONIBEK\Desktop\spravka` (referred to below as `$SPRAVKA`).

---

### Task 1: Project scaffold + build toolchain

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.js`, `postcss.config.js`, `tailwind.config.ts`,
  `vitest.config.ts`, `.env.example`
- Create: `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`

**Interfaces:**
- Produces: a buildable Next app; `@/*` path alias → `src/*`; `npm test` runs vitest.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "docsystem",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev -H 0.0.0.0 -p 5200",
    "build": "prisma generate && next build",
    "start": "next start -H 0.0.0.0 -p 5200",
    "test": "vitest run",
    "db:push": "prisma db push",
    "db:seed": "tsx prisma/seed.ts"
  },
  "dependencies": {
    "@prisma/client": "^5.22.0",
    "bcryptjs": "^2.4.3",
    "iconsax-react": "^0.0.8",
    "jose": "^5.9.6",
    "nanoid": "^5.0.9",
    "next": "14.2.18",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@fontsource/arimo": "^5.2.8",
    "@fontsource/tinos": "^5.2.7",
    "@testing-library/react": "^16.3.2",
    "@testing-library/user-event": "^14.6.1",
    "@types/bcryptjs": "^2.4.6",
    "@types/node": "^20.17.6",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "autoprefixer": "^10.4.20",
    "happy-dom": "^20.11.0",
    "postcss": "^8.4.49",
    "prisma": "^5.22.0",
    "tailwindcss": "^3.4.15",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  },
  "engines": { "node": ">=22" }
}
```

- [ ] **Step 2: Copy config from spravka and adapt**

Copy `$SPRAVKA/apps/web-yurist/{tsconfig.json,next.config.js,postcss.config.js,tailwind.config.ts}`
into the repo root. Then:
- In `tailwind.config.ts`, set `content` to `['./src/**/*.{ts,tsx}']` (drop the monorepo
  `../../packages` globs). Keep the spravka theme/tokens block verbatim.
- In `tsconfig.json`, ensure `"paths": { "@/*": ["./src/*"] }` and `"baseUrl": "."`; remove any
  `@spravka/*` path mappings.
- `next.config.js`: remove `transpilePackages: ['@spravka/shared']` if present; keep the rest.

- [ ] **Step 3: Copy `globals.css`**

Copy `$SPRAVKA/packages/shared/src/ui/globals.css` → `src/app/globals.css` verbatim (it already
contains the design tokens and the `.cert-sheet` A4 geometry used later by the ariza preview).

- [ ] **Step 4: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}'] },
});
```

- [ ] **Step 5: Write minimal `src/app/layout.tsx` and `src/app/page.tsx`**

```tsx
// src/app/layout.tsx
import './globals.css';
export const metadata = { title: 'Docsystem' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="uz"><body>{children}</body></html>);
}
```
```tsx
// src/app/page.tsx
export default function Home() { return <main style={{ padding: 24 }}>Docsystem</main>; }
```

- [ ] **Step 6: Write `.env.example`**

```
DATABASE_URL="mysql://docsystem:docsystem@localhost:3307/docsystem"
SESSION_SECRET="change-me-32-bytes-minimum-secret-string"
DOCSYSTEM_ADMIN_USERNAME="admin"
DOCSYSTEM_ADMIN_PASSWORD="admin"
```
Copy to `.env` locally (git-ignored). **Never commit `.env`.**

- [ ] **Step 7: Install and build**

Run: `npm install`
Run: `npm run build`
Expected: build fails on Prisma generate (no schema yet) — acceptable at this task; instead verify
Next compiles by running `npx next build` after temporarily skipping prisma, OR proceed knowing
Task 3 adds the schema. Minimal gate here: `npx tsc --noEmit` passes and `npm run dev` serves
`Docsystem` at http://localhost:5200.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "chore: scaffold Next 14 app + Tailwind + design tokens"
```

---

### Task 2: Copy spravka design-system UI

**Files:**
- Create (copy): `src/ui/*` (subset below), `src/core/document.ts`, `src/core/chamber.ts`
- Create: `src/ui/firm-types.ts`, `src/ui/index.ts` (trimmed barrel)
- Test: `src/ui/ui-smoke.test.tsx`

**Interfaces:**
- Produces: `AppShell`, `Field`/`TextField`/`DateField`/`PasswordField`, `Filters`, `Pagination`,
  `Select`, `Modal`, `Calendar`, `Charts`, `FilePicker`, `Spinner`, `Splash`, `ThemeToggle`, `Logo`,
  `Table`/`PageHeader`/`StatCard`/`EmptyState`/`StatusBadge` (from `components.tsx`), `NAV_ICONS`/`Ico`,
  `CourtArizaDocument` (QR-free), and formatters `formatSumDecimal`/`dmy`/`uzLongDateLatin`/
  `arizaHeaderDate` + `DocContract` type + `CHAMBER`/`CHAMBER_SIGNER` constants.

- [ ] **Step 1: Copy the UI subset**

Copy these from `$SPRAVKA/packages/shared/src/ui/` → `src/ui/`:
`AppShell.tsx, components.tsx, Field.tsx, Filters.tsx, Pagination.tsx, Select.tsx, Modal.tsx,
Calendar.tsx, Charts.tsx, ClickableRow.tsx, DatePicker.tsx, FilePicker.tsx, Spinner.tsx, Splash.tsx,
ThemeToggle.tsx, Logo.tsx, icons.tsx, tokens.ts, chamber-emblem.data.ts, CourtArizaDocument.tsx`

Copy from `$SPRAVKA/packages/shared/src/core/` → `src/core/`:
`document.ts, chamber.ts`

- [ ] **Step 2: Add the `CertFirm` type locally**

`CourtArizaDocument.tsx` imports `CertFirm` from `./CertificateDocument` (not copied). Create
`src/ui/firm-types.ts`:

```ts
/** The firm fields the ariza's «undiruvchi» block reads. Latin ariza forms preferred. */
export interface CertFirm {
  name: string;
  letterheadName?: string | null;
  arizaName?: string | null;
  address?: string | null;
  arizaAddress?: string | null;
  bankAccount?: string | null;
  mfo?: string | null;
  stir?: string | null;
}
```
In `CourtArizaDocument.tsx`, change `import type { CertFirm } from './CertificateDocument';` →
`import type { CertFirm } from './firm-types';`.

- [ ] **Step 3: Remove the QR from `CourtArizaDocument.tsx`**

Delete the `qrDataUrl?: string;` prop from `CourtArizaDocumentProps`, and delete the entire
`{p.qrDataUrl && ( … )}` block in the footer plus the `paddingTop`/`borderTop` ternaries that
reference `p.qrDataUrl` (set the footer `div` to a plain `marginTop: '14pt'`, no border). No other
QR references remain.

- [ ] **Step 4: Fix any transitive imports**

Resolve remaining import errors by copying any small helper a copied file imports (e.g. `tokens.ts`
is already copied; if `components.tsx`/`icons.tsx` import from `./tokens` or `iconsax-react`, those
resolve). Do NOT copy eimzo/QrCard/certificate/ishonchnoma/document-edit files.

- [ ] **Step 5: Write a trimmed barrel `src/ui/index.ts`**

Export only the copied components/types (mirror spravka's `index.ts` lines for the copied files;
drop lines for anything not copied). Include:
`AppShell, ThemeToggle, Logo, Splash, Spinner, Ico, NAV_ICONS, Modal, Select, TextField, DateField,
TextArea, PasswordField, FilePicker, Filters, Pagination, Calendar, UZ_MONTHS_LAT, BarChart,
DonutChart, HBarChart, ClickableRow, RowAction, ViewAction, STATUS_DOT, StatusBadge, StatCard,
PageHeader, EmptyState, Table, ThemeScript, CourtArizaDocument` and the `CertFirm` type.

- [ ] **Step 6: Write the smoke test `src/ui/ui-smoke.test.tsx`**

```tsx
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { CourtArizaDocument } from './index';
import { formatSumDecimal } from '../core/document';

describe('ui copy', () => {
  it('formats sums like spravka', () => {
    expect(formatSumDecimal('11665392.28')).toContain('11');
  });
  it('renders the ariza with no QR', () => {
    const html = renderToStaticMarkup(
      <CourtArizaDocument
        number="" issueDate={new Date('2026-07-09')} courtName="Test sudi"
        personFullName="TEST AAA" personPinfl="123" personAddress="Addr" personPhone="998"
        contracts={[{ number: '2244', date: new Date('2026-05-12') }]}
        contractType="ONLAYN" interestRate="54" loanAmount="1000000"
        asOfDate={new Date('2026-07-09')} debtPrincipal="1" debtTermInterest="2"
        debtOverduePrincipal="3" debtOverdueInterest="4" debtTotal="10"
        chamberSignerPosition="X" chamberSignerName="Y" chamberExecutorName="Z"
        chamberExecutorPhone="1" firm={{ name: 'BRIGHT FUTURE FINANCING' }} />,
    );
    expect(html).toContain('A R I Z A');
    expect(html).not.toContain('QR');
  });
});
```

- [ ] **Step 7: Run the smoke test**

Run: `npm test -- src/ui/ui-smoke.test.tsx`
Expected: PASS (ariza renders, contains "A R I Z A", contains no "QR").

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: copy spravka design system + QR-free ariza"
```

---

### Task 3: Prisma + MySQL (Admin, Firm) + db client

**Files:**
- Create: `prisma/schema.prisma`, `src/lib/db.ts`, `docker-compose.yml`
- Test: `src/lib/db.test.ts`

**Interfaces:**
- Produces: `prisma` client singleton at `@/lib/db` (`import { prisma } from '@/lib/db'`); `Admin`
  and `Firm` models.

- [ ] **Step 1: Write `prisma/schema.prisma`**

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "mysql"; url = env("DATABASE_URL") }

model Admin {
  id           Int    @id @default(autoincrement())
  username     String @unique
  passwordHash String
  createdAt    DateTime @default(now())
}

model Firm {
  id          Int     @id @default(autoincrement())
  code        String  @unique          // branch code, e.g. "12842"
  shortName   String                    // "BRIGHT FUTURE FINANCING"
  legalName   String?                   // full legal Latin name for the ariza
  address     String?
  bankAccount String?                   // X/R
  mfo         String?
  stir        String?
  postIndex   String?
  phone       String?
  updatedAt   DateTime @updatedAt
}
```

- [ ] **Step 2: Write `docker-compose.yml` (mysql on 3307)**

```yaml
services:
  mysql:
    image: mysql:8.4
    environment:
      MYSQL_ROOT_PASSWORD: root
      MYSQL_DATABASE: docsystem
      MYSQL_USER: docsystem
      MYSQL_PASSWORD: docsystem
    ports: ["3307:3306"]
    volumes: ["docsystem_mysql:/var/lib/mysql"]
volumes: { docsystem_mysql: {} }
```

- [ ] **Step 3: Write `src/lib/db.ts`**

```ts
import { PrismaClient } from '@prisma/client';
const g = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = g.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') g.prisma = prisma;
```

- [ ] **Step 4: Bring up DB and push schema**

Run: `docker compose up -d mysql`
Run: `npx prisma db push`
Expected: "Your database is now in sync with your Prisma schema."

- [ ] **Step 5: Write `src/lib/db.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { prisma } from './db';
describe('db', () => {
  it('connects and counts admins', async () => {
    const n = await prisma.admin.count();
    expect(typeof n).toBe('number');
  });
});
```

- [ ] **Step 6: Run it**

Run: `npm test -- src/lib/db.test.ts`
Expected: PASS (count is a number; 0 before seeding).

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: Prisma schema (Admin, Firm) + MySQL compose + db client"
```

---

### Task 4: Auth — password/session + login + middleware

**Files:**
- Create (copy): `src/core/password.ts`, `src/core/session.ts`, `src/core/password.test.ts`,
  `src/core/session.test.ts`
- Create: `src/lib/auth.ts`, `src/app/login/page.tsx`, `src/app/api/auth/login/route.ts`,
  `src/app/api/auth/logout/route.ts`, `src/middleware.ts`

**Interfaces:**
- Consumes: `prisma` from `@/lib/db`; `CHAMBER`? no.
- Produces: `hashPassword`/`verifyPassword` (from `password.ts`); `createSession`/`readSession`
  (from `session.ts`, signature per spravka); `getSession(): Promise<{username:string}|null>` and
  `requireAdmin()` from `@/lib/auth`.

- [ ] **Step 1: Copy the tested auth core**

Copy `$SPRAVKA/packages/shared/src/core/{password.ts,password.test.ts,session.ts,session.test.ts}`
→ `src/core/`. Read `session.ts` to learn its exact exports (cookie name, `SESSION_SECRET` env, sign/
verify function names).

- [ ] **Step 2: Run the copied tests to confirm the copy is intact**

Run: `npm test -- src/core/password.test.ts src/core/session.test.ts`
Expected: PASS (these are spravka's own passing tests).

- [ ] **Step 3: Write `src/lib/auth.ts`**

Use the exact function names discovered in Step 1. Template (adjust names to `session.ts`):

```ts
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { readSession } from '@/core/session';

export async function getSession() {
  const token = cookies().get('docsystem_session')?.value;
  if (!token) return null;
  try { return await readSession(token); } catch { return null; }
}
export async function requireAdmin() {
  const s = await getSession();
  if (!s) redirect('/login');
  return s;
}
```

- [ ] **Step 4: Write the login route `src/app/api/auth/login/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyPassword } from '@/core/password';
import { createSession } from '@/core/session';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();
  const admin = await prisma.admin.findUnique({ where: { username } });
  if (!admin || !(await verifyPassword(password, admin.passwordHash))) {
    return NextResponse.json({ error: 'Login yoki parol xato' }, { status: 401 });
  }
  const token = await createSession({ username: admin.username });
  const res = NextResponse.json({ ok: true });
  res.cookies.set('docsystem_session', token, {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
```
(Match `createSession`'s real signature/return from `session.ts`.)

- [ ] **Step 5: Write logout `src/app/api/auth/logout/route.ts`**

```ts
import { NextResponse } from 'next/server';
export const runtime = 'nodejs';
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set('docsystem_session', '', { path: '/', maxAge: 0 });
  return res;
}
```

- [ ] **Step 6: Write `src/app/login/page.tsx`**

A centered card (reuse `.card`, `.btn-primary`, `.field-input` classes from globals.css) with
username + password inputs that POST to `/api/auth/login`, then `router.push('/')` on success and
show the error text on 401. Client component (`'use client'`).

- [ ] **Step 7: Write `src/middleware.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
export function middleware(req: NextRequest) {
  const token = req.cookies.get('docsystem_session')?.value;
  const isLogin = req.nextUrl.pathname.startsWith('/login');
  const isAuthApi = req.nextUrl.pathname.startsWith('/api/auth');
  if (!token && !isLogin && !isAuthApi) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  return NextResponse.next();
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
```

- [ ] **Step 8: Manual verification (after Task 5 seed)**

Deferred check noted here: once the admin is seeded (Task 5), `npm run dev`, visit `/` → redirected
to `/login`; wrong password → error; correct → lands on `/`.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: single-admin auth (login, session, middleware)"
```

---

### Task 5: Admin + Firm seed

**Files:**
- Create: `src/core/firms.seed.ts`, `prisma/seed.ts`
- Test: `src/core/firms.seed.test.ts`

**Interfaces:**
- Consumes: `hashPassword` from `@/core/password`; `prisma` from `@/lib/db`.
- Produces: `FIRMS_SEED` array (9 rows) from `@/core/firms.seed`.

- [ ] **Step 1: Write `src/core/firms.seed.ts`**

```ts
export interface FirmSeed {
  code: string; shortName: string; legalName?: string; address?: string;
  bankAccount?: string; mfo?: string; stir?: string; postIndex?: string;
}
/** Post index 100174 for all; only Bright Future has full rekvizit from the sample ariza. */
export const FIRMS_SEED: FirmSeed[] = [
  { code: '12842', shortName: 'BRIGHT FUTURE FINANCING',
    legalName: '«BRIGHT FUTURE FINANCING» MIKROMOLIYA TASHKILOTI MCHJ',
    address: 'Toshkent shahar, Olmazor tumani, Guruchariq MFY, Sagʻbon koʻchasi 30 berk, 7/1-uy',
    bankAccount: '20216000207212842001', mfo: '01183', stir: '311 976 765', postIndex: '100174' },
  { code: '06292', shortName: 'URBAN FINANCE SOLUTIONS', postIndex: '100174' },
  { code: '55890', shortName: 'COMMUNITY MMT', postIndex: '100174' },
  { code: '05557', shortName: 'MUVAFFAQIYAT MMT', postIndex: '100174' },
  { code: '14276', shortName: 'FUNDFLOW', postIndex: '100174' },
  { code: '31685', shortName: 'ZAYMLY', postIndex: '100174' },
  { code: '31734', shortName: 'DARROWMAD', postIndex: '100174' },
  { code: '55899', shortName: 'DYNAMIC CREDIT SOLUTIONS MIKROMOLIYA TASHKILOTI', postIndex: '100174' },
  { code: '07634', shortName: '"PRESTIGE MOLIYA" MCHJ MMT', postIndex: '100174' },
];
```

- [ ] **Step 2: Write `src/core/firms.seed.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { FIRMS_SEED } from './firms.seed';
describe('firm seed', () => {
  it('has 9 firms with unique codes', () => {
    expect(FIRMS_SEED).toHaveLength(9);
    expect(new Set(FIRMS_SEED.map(f => f.code)).size).toBe(9);
  });
  it('has Bright Future full rekvizit', () => {
    const bf = FIRMS_SEED.find(f => f.code === '12842')!;
    expect(bf.bankAccount).toBe('20216000207212842001');
    expect(bf.stir).toBe('311 976 765');
  });
});
```

- [ ] **Step 3: Run it**

Run: `npm test -- src/core/firms.seed.test.ts`
Expected: PASS.

- [ ] **Step 4: Write `prisma/seed.ts`**

```ts
import { prisma } from '../src/lib/db';
import { hashPassword } from '../src/core/password';
import { FIRMS_SEED } from '../src/core/firms.seed';

async function main() {
  const username = process.env.DOCSYSTEM_ADMIN_USERNAME || 'admin';
  const password = process.env.DOCSYSTEM_ADMIN_PASSWORD || 'admin';
  await prisma.admin.upsert({
    where: { username },
    update: {},
    create: { username, passwordHash: await hashPassword(password) },
  });
  for (const f of FIRMS_SEED) {
    await prisma.firm.upsert({ where: { code: f.code }, update: {}, create: f });
  }
  console.log('seeded admin + firms');
}
main().finally(() => prisma.$disconnect());
```
(If `password.ts` uses a differently-named hash function, match it.)

- [ ] **Step 5: Run the seed**

Run: `npm run db:seed`
Expected: "seeded admin + firms"; `npx prisma studio` (or a count) shows 1 admin + 9 firms.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: seed single admin + 9 firms"
```

---

### Task 6: AppShell nav + Firms CRUD + dashboard/settings skeleton

**Files:**
- Create: `src/app/(app)/layout.tsx`, `src/app/(app)/page.tsx`, `src/app/(app)/firms/page.tsx`,
  `src/app/(app)/firms/FirmForm.tsx`, `src/app/api/firms/[id]/route.ts`,
  `src/app/(app)/settings/page.tsx`
- Test: `src/app/firms-actions.test.ts` (server action / update helper if extracted)

**Interfaces:**
- Consumes: `requireAdmin` from `@/lib/auth`; `AppShell`, `Table`, `Field`, `PageHeader`,
  `StatCard` from `@/ui`.
- Produces: an authenticated shell whose nav links to Kalendar (`/`), Import (`/import`), Firmalar
  (`/firms`), Sozlamalar (`/settings`) — later plans fill Import/Kalendar.

- [ ] **Step 1: Write the authenticated layout `src/app/(app)/layout.tsx`**

Server component: `await requireAdmin()`, then render `<AppShell nav={…} panels={…}>{children}</AppShell>`
using spravka's `AppShell` prop shape (read `$SPRAVKA/apps/web-yurist/src/app` layout for the exact
`NavItem`/`NavPanel` usage). Nav items: `{ label: 'Kalendar', href: '/', icon: NAV_ICONS.… }`,
`Import` → `/import`, `Firmalar` → `/firms`, `Sozlamalar` → `/settings`. Include a logout action
POSTing `/api/auth/logout` then redirecting to `/login`.

- [ ] **Step 2: Write the dashboard `src/app/(app)/page.tsx`**

Server component: a `PageHeader title="Kalendar"` + an `EmptyState` saying «Hali portfel yuklanmagan —
Import bo'limidan yuklang» (the real calendar comes in Plan 2). Verify it renders behind auth.

- [ ] **Step 3: Write the Firms list `src/app/(app)/firms/page.tsx`**

Server component: `const firms = await prisma.firm.findMany({ orderBy: { code: 'asc' } })`, render a
`Table` with columns Kod / Nomi / STIR / X/R and a row action opening `FirmForm` (a client modal) to
edit rekvizit.

- [ ] **Step 4: Write `FirmForm.tsx` (client) + update route**

`FirmForm.tsx`: `'use client'` modal with `TextField`s for shortName, legalName, address, bankAccount,
mfo, stir, postIndex, phone; on save `PATCH /api/firms/{id}`.
`src/app/api/firms/[id]/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
export const runtime = 'nodejs';
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const data = await req.json();
  const firm = await prisma.firm.update({ where: { id: Number(params.id) }, data });
  return NextResponse.json(firm);
}
```

- [ ] **Step 5: Write the settings skeleton `src/app/(app)/settings/page.tsx`**

A `PageHeader title="Sozlamalar"` + a note listing the future editable defaults (default court =
«Fuqarolik ishlari boʻyicha Uchtepa tumanlararo sudiga», contract type = «ONLAYN», chamber signer).
Persisting these is Plan 3/4; this task only renders the placeholder so nav is complete.

- [ ] **Step 6: Verify the shell end-to-end**

Run: `npm run dev`. Log in with the seeded admin → land on `/` (Kalendar empty state). Click
Firmalar → see 9 firms; edit Bright Future's phone → save → reload shows the change. `npm run build`
passes.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: authenticated shell + firms CRUD + settings skeleton"
```

---

## Self-review notes

- **Spec coverage (Plan 1 scope):** §4 stack/UI-reuse → Tasks 1–2; §5 Admin/Firm → Tasks 3,5; §7
  shell/firms/settings pages → Task 6; §8 admin+firm seed → Task 5. Snapshot/Loan/Job, import,
  browse, export are Plans 2–4 (roadmap).
- **Auth reuse:** exact `session.ts`/`password.ts` export names are confirmed in Task 4 Step 1 before
  wiring — the templates say to match them, avoiding a signature mismatch.
- **No secrets:** admin password comes from env at seed time; `.env` is git-ignored.
