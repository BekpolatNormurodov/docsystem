// Render a talabnoma row to PDF on our side, using the hippo HTML template
// (signature/letterhead embedded). Fills {{placeholder}} tokens, then prints
// via headless Chromium (Playwright). Same field set as the Excel.
import fs from 'node:fs';
import path from 'node:path';
import type { Browser } from 'playwright';
import { regionName, areaName } from '@/core/hippo-regions';
import type { TalabnomaRow } from './talabnoma-excel';

// The template is cached but re-read when the .html changes on disk (mtime
// guard) — edits take effect without a server restart, no stale-template footgun.
const TEMPLATE_PATH = path.join(process.cwd(), 'src/lib/hippo/talabnoma-template.html');
let TEMPLATE: string | null = null;
let TEMPLATE_MTIME = 0;
const template = () => {
  const mtime = fs.statSync(TEMPLATE_PATH).mtimeMs;
  if (TEMPLATE === null || mtime !== TEMPLATE_MTIME) {
    TEMPLATE = fs.readFileSync(TEMPLATE_PATH, 'utf8');
    TEMPLATE_MTIME = mtime;
  }
  return TEMPLATE;
};

const dmy = (d: Date | null): string =>
  d ? `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}` : '';

// Build the {{token}} -> value map for one row. region/area become Cyrillic
// NAMES in the letter (the Excel carries the numeric IDs; the PDF is human).
export function talabnomaFields(row: TalabnomaRow): Record<string, string> {
  return {
    date: dmy(row.date),
    contract_id: row.contract_id,
    address: row.address,
    receiver: row.receiver,
    contract_date: dmy(row.contract_date),
    contract_number: row.contract_number,
    loan_amount: new Intl.NumberFormat('ru-RU').format(row.loan_amount),
    loan_amount_words: row.loan_amount_words,
    total_debt: new Intl.NumberFormat('ru-RU').format(row.total_debt),
    total_debt_words: row.total_debt_words,
    region: regionName(row.region),
    area: areaName(row.area),
  };
}

// The letterhead firm — filled into the template header (was hardcoded to one
// firm, which put the wrong letterhead on every other firm's talabnoma).
export interface TalabnomaFirm {
  legalName?: string | null; shortName?: string | null; address?: string | null;
  stir?: string | null; bankAccount?: string | null; mfo?: string | null; phone?: string | null;
}

function firmFields(firm?: TalabnomaFirm | null): Record<string, string> {
  const bank: string[] = [];
  if (firm?.stir) bank.push(`ИНН ${firm.stir}.`);
  if (firm?.bankAccount) bank.push(`Х/р ${firm.bankAccount}`);
  if (firm?.mfo) bank.push(`МФО ${firm.mfo}.`);
  return {
    firm_name: firm?.legalName || firm?.shortName || '',
    firm_address: firm?.address ?? '',
    firm_bank: bank.join(' '),
    firm_contact: firm?.phone ? `Тел: ${firm.phone}` : '',
  };
}

export function fillTemplate(row: TalabnomaRow, firm?: TalabnomaFirm | null): string {
  const f = { ...talabnomaFields(row), ...firmFields(firm) };
  return template().replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_m, key: string) => f[key] ?? '');
}

// Render one row's filled HTML to a PDF buffer. Pass a shared `browser` when
// rendering many rows so Chromium launches once. `firm` fills the letterhead.
export async function renderTalabnomaPdf(row: TalabnomaRow, browser: Browser, firm?: TalabnomaFirm | null): Promise<Buffer> {
  const page = await browser.newPage();
  try {
    await page.setContent(fillTemplate(row, firm), { waitUntil: 'networkidle' });
    return await page.pdf({ format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' } });
  } finally {
    await page.close();
  }
}

// Convenience: render a batch of rows to PDF files in `outDir`, launching one
// browser. Returns the written file paths.
export async function renderTalabnomaPdfs(rows: TalabnomaRow[], outDir: string): Promise<string[]> {
  const { chromium } = await import('playwright');
  await fs.promises.mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const written: string[] = [];
  try {
    for (const row of rows) {
      const buf = await renderTalabnomaPdf(row, browser);
      const safe = `${row.contract_id.replace(/\//g, '-')}_${row.receiver.replace(/[^\wА-Яа-яЎўҚқҒғҲҳ]+/g, '_').slice(0, 40)}.pdf`;
      const p = path.join(outDir, safe);
      await fs.promises.writeFile(p, buf);
      written.push(p);
    }
  } finally {
    await browser.close();
  }
  return written;
}
