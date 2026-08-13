// Palatadan qaytgan IMZOLANGAN arizalar (skan) ni case/portfel bilan bogʻlab
// firma boʻyicha xulosa beradi. Dataset — skanni OCR qilib chiqarilgan `data/
// palata-scan.json` (har ariza: reg №, PINFL, firma, ism, sahifa, manzil).
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from './db';

const DATA_PATH = path.join(process.cwd(), 'data', 'palata-scan.json');

export interface ScannedAriza {
  reg: string;       // palata registratsiya raqami (147820…)
  pages: string;     // skandagi sahifa oraligʻi ("1-2")
  name: string;      // qarzdor F.I.Sh
  pinfl: string;     // JShShIR — moslash kaliti
  firmKey: string;   // arizada koʻringan firma (BRIGHT/URBAN/…)
  address?: string;  // toʻliq manzil (bonus)
  source?: string;   // saqlangan skan fayli (exports/palata-scans/) — yuklab olish uchun
}

export interface FirmScanStat { firm: string; total: number; matched: number; withCase: number; saved: number }
export interface ScanRow {
  reg: string; name: string; pinfl: string; firm: string; address: string;
  hasCase: boolean;       // pipeline'da case bor
  hasPortfolio: boolean;  // portfelda (Loan) bor
  hasScan: boolean;       // imzolangan skani saqlangan (yuklab olsa boʻladi)
  caseId: number | null;  // moslashgan case (pinfl × firma) id'si
  linked: boolean;        // ariza case'ga alohida PDF qilib bazaga biriktirilgan (SIGNED_ARIZA)
}
export interface PalataScanSummary {
  total: number;          // skandan oʻqilgan arizalar
  matched: number;        // portfelda topilgani (PINFL mos)
  withCase: number;       // pipeline'da case bori
  noCase: number;         // case yoʻq (masalan excluded=false)
  saved: number;          // case'ga alohida PDF qilib bazaga saqlangani (sud paketiga tayyor)
  firms: FirmScanStat[];  // firma boʻyicha
  arizas: ScanRow[];      // batafsil roʻyxat (case yoʻqlar oldinda)
  updatedAt: string | null;
}

// Cache the parsed dataset keyed by the file's mtime. This JSON is read on every
// court-readiness / drill-down / export-validate call; re-reading + JSON.parse each
// time blocks the event loop. A cheap statSync guards the cache and only re-parses
// after the OCR pipeline rewrites the file (which bumps mtime). Same rows out —
// callers that mutate the array would be surprised, but every caller is read-only.
let _scanCache: { mtimeMs: number; rows: ScannedAriza[] } | null = null;
export function readScannedArizas(): ScannedAriza[] {
  try {
    const mtimeMs = fs.statSync(DATA_PATH).mtimeMs;
    if (_scanCache && _scanCache.mtimeMs === mtimeMs) return _scanCache.rows;
    const rows = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')) as ScannedAriza[];
    _scanCache = { mtimeMs, rows };
    return rows;
  } catch { return []; }
}

export async function palataScanSummary(): Promise<PalataScanSummary> {
  const rows = readScannedArizas();
  const stat = fs.existsSync(DATA_PATH) ? fs.statSync(DATA_PATH).mtime.toISOString() : null;
  if (rows.length === 0) return { total: 0, matched: 0, withCase: 0, noCase: 0, saved: 0, firms: [], arizas: [], updatedAt: stat };

  const pinfls = [...new Set(rows.map((r) => r.pinfl).filter(Boolean))];
  const [loans, cases, firms] = await Promise.all([
    // Keep the (pinfl, branchCode) pair — a client may have loans at several firms,
    // so we match the ariza's firm, not an arbitrary one.
    prisma.loan.findMany({ where: { pinfl: { in: pinfls } }, select: { pinfl: true, branchCode: true }, distinct: ['pinfl', 'branchCode'] }),
    prisma.arizaCase.findMany({ where: { pinfl: { in: pinfls } }, select: { id: true, pinfl: true, firmId: true }, orderBy: { id: 'asc' } }),
    prisma.firm.findMany({ select: { id: true, code: true, shortName: true } }),
  ]);
  // Which of those cases already carry a signed-ariza PDF in the DB — «bazaga saqlangan».
  const caseIds = cases.map((c) => c.id);
  const signedDocs = caseIds.length
    ? await prisma.caseDocument.findMany({ where: { caseId: { in: caseIds }, kind: 'SIGNED_ARIZA' }, select: { caseId: true } })
    : [];
  const signedSet = new Set(signedDocs.map((d) => d.caseId));

  const firmByKey = (key: string) => firms.find((f) => (f.shortName || '').toUpperCase().includes(key));
  const loanPairs = new Set(loans.map((l) => `${l.pinfl}::${l.branchCode}`));
  // (pinfl::firmId) → the case ids at that firm (latest last, orderBy id asc).
  const caseIdsByPair = new Map<string, number[]>();
  for (const c of cases) {
    const k = `${c.pinfl}::${c.firmId}`;
    const arr = caseIdsByPair.get(k) ?? [];
    arr.push(c.id);
    caseIdsByPair.set(k, arr);
  }

  const per = new Map<string, FirmScanStat>();
  const arizas: ScanRow[] = [];
  let matched = 0, withCase = 0, saved = 0;
  for (const r of rows) {
    const firm = firmByKey(r.firmKey);
    const label = firm?.shortName || r.firmKey || 'Nomaʼlum';
    // Client exists at THIS firm's portfolio, and has a pipeline case at THIS firm.
    const inPortfolio = firm ? loanPairs.has(`${r.pinfl}::${firm.code}`) : false;
    const ids = firm ? caseIdsByPair.get(`${r.pinfl}::${firm.id}`) ?? [] : [];
    const inPipeline = ids.length > 0;
    // «Bazaga saqlangan» — the case's own signed-ariza PDF exists (court-packet ready).
    const linked = ids.some((id) => signedSet.has(id));
    if (inPortfolio) matched++;
    if (inPipeline) withCase++;
    if (linked) saved++;
    const s = per.get(label) ?? { firm: label, total: 0, matched: 0, withCase: 0, saved: 0 };
    s.total++; if (inPortfolio) s.matched++; if (inPipeline) s.withCase++; if (linked) s.saved++;
    per.set(label, s);
    arizas.push({ reg: r.reg, name: r.name, pinfl: r.pinfl, firm: label, address: r.address || '', hasCase: inPipeline, hasPortfolio: inPortfolio, hasScan: !!r.source, caseId: ids[ids.length - 1] ?? null, linked });
  }
  // Case yoʻqlar (eʼtibor talab qiladiganlar) roʻyxat boshida; soʻng firma + ism.
  arizas.sort((a, b) => Number(a.hasCase) - Number(b.hasCase) || a.firm.localeCompare(b.firm) || a.name.localeCompare(b.name));
  return {
    total: rows.length, matched, withCase, noCase: rows.length - withCase, saved,
    firms: [...per.values()].sort((a, b) => b.total - a.total),
    arizas,
    updatedAt: stat,
  };
}
