// Parse the uploaded Excels into a reduced candidates.json. Data model (foydalanuvchi so'rovi):
//   · talabnoma manba: JUST a PINFL list (Latin PNFL/PINFL or Cyrillic, any case — the same tiny
//     file the istisno slot takes). It supplies ONLY the pinfl set; nothing else is read from it.
//   · portfel: 185k loan rows — STREAMED, keeping only rows whose pinfl is in that set, to bound
//     memory. EVERY other field (FIO, address, region, district, per-firm & total debt) is derived
//     from the portfolio via the shared mapRowToLoan, so it matches the main import exactly.
//   · firm names: from the DB Firm table (the letters already use DB letterhead), so no Лист3.
import fs from 'node:fs/promises';
import { prisma } from '@/lib/db';
import Excel from 'exceljs';
import { mapRowToLoan } from '@/core/portfolio';
import { parseExclusionPinfls } from '@/lib/parse-exclusion';
import { canonCode, DEFAULT_THRESHOLD, evaluate } from './filter';
import type { CandidatePerson, CandidatesFile } from './types';

/** Prefer the FULLEST address seen for a person (portfolio rows vary: some carry the full street,
 *  some collapse to «X tumani»). Longest non-empty wins. */
function fullest(...candidates: (string | null | undefined)[]): string | null {
  const cleaned = candidates.map((c) => (c ?? '').trim()).filter(Boolean);
  if (!cleaned.length) return null;
  return cleaned.reduce((best, c) => (c.length > best.length ? c : best));
}

export interface ParseSummary {
  candidateCount: number;
  qualifiedCount: number;
  firms: { code: string; name: string; ready: boolean; personCount: number }[];
  readyPersonCount: number;
  unreadyPersonCount: number;
  portfolioMatched: number; // people who got ≥1 portfolio loan
}

export interface ParseOutput {
  file: CandidatesFile;
  summary: ParseSummary;
}

/** Read the talabnoma PINFL list + stream the portfolio into a CandidatesFile. `docDate` = the
 *  talabnoma document date. Person identity/amounts come entirely from the portfolio. */
export async function parseTalabnomaForm(
  sourcePath: string,
  portfolioPath: string,
  docDate: Date,
  onProgress?: (rowsStreamed: number) => void | Promise<void>,
): Promise<ParseOutput> {
  // 1) Talabnoma manba → just the set of PINFLs to build letters for (robust Latin/Cyrillic header
  //    detection, reused from the istisno parser). No FIO/amount is taken from here.
  let wanted: Set<string>;
  try {
    wanted = await parseExclusionPinfls(sourcePath);
  } catch (e) {
    throw new Error(`PINFL roʻyxati faylini oʻqib boʻlmadi (fayl buzuq yoki .xlsx emas): ${e instanceof Error ? e.message : String(e)}`);
  }

  // Seed a person per wanted pinfl so nobody is silently dropped even if the portfolio has no match.
  const byPinfl = new Map<string, CandidatePerson>();
  const seed = () => {
    byPinfl.clear();
    for (const pinfl of wanted) {
      byPinfl.set(pinfl, { pinfl, fio: null, totalOverdue: 0, address: null, phone: null, region: null, district: null, firmsText: null, perFirm: {}, loans: [] });
    }
  };
  seed();

  const matched = new Set<string>();
  const firmCodes = new Set<string>();
  let streamed = 0;

  // Bitta portfel qatorini qayta ishlash — STREAM va zaxira (readFile) yoʻllari uchun umumiy.
  const processRow = (header: string[], values: unknown[]) => {
    streamed += 1;
    const loan = mapRowToLoan(header, values);
    if (!loan.pinfl) return;
    const person = byPinfl.get(loan.pinfl);
    if (!person) return;
    const distrName = (loan.raw as any)?.distr_name != null ? String((loan.raw as any).distr_name) : null;
    person.loans.push({
      branch: loan.branchCode, clientName: loan.clientName, ldId: loan.ldId,
      dateToCr: loan.dateToCr ? loan.dateToCr.toISOString() : null,
      summKr: loan.summKr, totalDebt: loan.totalDebt,
      postAddress: loan.postAddress, postAddressUz: loan.postAddressUz,
      regionName: loan.regionName, distrName,
    });
    // Identity / amounts — all from portfel.
    person.fio = person.fio ?? loan.clientName;
    person.address = fullest(person.address, loan.postAddressUz, loan.postAddress);
    person.region = person.region ?? loan.regionName;
    person.district = person.district ?? distrName;
    const code = canonCode(loan.branchCode);
    person.perFirm[code] = (person.perFirm[code] ?? 0) + Math.abs(loan.totalDebt);
    person.totalOverdue += Math.abs(loan.totalDebt);
    firmCodes.add(code);
    matched.add(loan.pinfl);
  };
  // Header row → normalized string[] if it carries a «pinfl» column, else null (decoy sheet).
  const asHeader = (values: unknown[]): string[] | null => {
    const h = values.map((v) => (v === null || v === undefined ? '' : String(v)));
    return h.includes('pinfl') ? h : null;
  };

  // 2) Портфель — STREAM (xotira-cheklangan). Ba'zi generatorlar (openpyxl / davlat eksportlari)
  //    «data descriptor» zip yozadi → exceljs stream reader «invalid signature: 0x…» xatosini beradi.
  //    Shu holda bardoshli (readFile) oʻqishga oʻtamiz — fayl baribir import boʻlsin.
  try {
    const reader = new Excel.stream.xlsx.WorkbookReader(portfolioPath, { worksheets: 'emit', sharedStrings: 'cache', entries: 'emit' });
    let foundWorksheet = false;
    for await (const worksheet of reader) {
      if (foundWorksheet) break; // only the first pinfl-bearing sheet
      let header: string[] | null = null;
      for await (const r of worksheet) {
        const raw = r.values as unknown[];
        const values = Array.isArray(raw) ? raw.slice(1) : [];
        if (header === null) {
          header = asHeader(values);
          if (!header) break; // decoy sheet — skip the rest of it
          foundWorksheet = true;
          continue;
        }
        processRow(header, values);
        if (onProgress && streamed % 2000 === 0) await onProgress(streamed);
      }
    }
    if (!foundWorksheet) throw new Error('stream: «pinfl» ustunli varaq topilmadi');
  } catch (streamErr) {
    // Zaxira: bardoshli readFile (markaziy katalogni oʻqiydi → data-descriptor zip'lar bilan ishlaydi).
    console.warn('[talabnoma-form] portfel stream oʻqishi uzildi, readFile zaxirasiga oʻtildi —', streamErr instanceof Error ? streamErr.message : streamErr);
    const st = await fs.stat(portfolioPath).catch(() => null);
    if (st && st.size > 100 * 1024 * 1024) {
      throw new Error(`Portfel fayli juda katta (${Math.round(st.size / 1048576)}MB) va zip formati stream oʻqishga mos emas. Faylni Excel'da oching va qaytadan «Saqlash» (.xlsx) qilib yuklang.`);
    }
    seed(); matched.clear(); firmCodes.clear(); streamed = 0; // stream davomida yigʻilgani bekor — toza boshlaymiz
    const wb = new Excel.Workbook();
    try {
      await wb.xlsx.readFile(portfolioPath);
    } catch (readErr) {
      throw new Error(`Portfel faylini oʻqib boʻlmadi (fayl buzuq yoki .xlsx emas): ${readErr instanceof Error ? readErr.message : String(readErr)}`);
    }
    let done = false;
    for (const ws of wb.worksheets) {
      if (done) break; // only the first pinfl-bearing sheet
      let header: string[] | null = null;
      ws.eachRow((row) => {
        const raw = row.values as unknown[];
        const values = Array.isArray(raw) ? raw.slice(1) : [];
        if (header === null) {
          header = asHeader(values);
          if (header) done = true; // shu varaqda qoldiq qatorlarni oʻqiymiz
          return;
        }
        processRow(header, values);
      });
    }
    if (!done) throw new Error('Portfel faylida «pinfl» ustunli varaq topilmadi — notoʻgʻri fayl yuklangan boʻlishi mumkin');
  }

  // 3) Firm names from the DB (code → shortName/legalName), so the summary UI shows real names.
  const firmNameByCode = await firmNamesByCode(firmCodes);

  const people = [...byPinfl.values()];
  const file: CandidatesFile = { docDate: docDate.toISOString(), firmNameByCode, people };

  const ev = evaluate(file, { thresholdTotal: DEFAULT_THRESHOLD, perFirmMin: 0 });
  const summary: ParseSummary = {
    candidateCount: people.length,
    qualifiedCount: ev.qualifiedPeople,
    firms: ev.firms.map((f) => ({ code: f.code, name: f.name, ready: f.ready, personCount: f.personCount })),
    readyPersonCount: ev.readyPersonCount,
    unreadyPersonCount: ev.unreadyPersonCount,
    portfolioMatched: matched.size,
  };
  return { file, summary };
}

/** DB Firm rows → canonical-code → display name map (shortName preferred, else legalName). */
async function firmNamesByCode(codes: Set<string>): Promise<Record<string, string>> {
  const firms = await prisma.firm.findMany({ select: { code: true, shortName: true, legalName: true } });
  const map: Record<string, string> = {};
  for (const f of firms) {
    const c = canonCode(f.code);
    if (codes.size === 0 || codes.has(c)) map[c] = f.shortName || f.legalName || c;
  }
  return map;
}

export async function writeCandidates(path: string, file: CandidatesFile): Promise<void> {
  await fs.writeFile(path, JSON.stringify(file));
}
export async function readCandidates(path: string): Promise<CandidatesFile> {
  return JSON.parse(await fs.readFile(path, 'utf8')) as CandidatesFile;
}
