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

export interface FirmScanStat { firm: string; total: number; matched: number; withCase: number }
export interface ScanRow {
  reg: string; name: string; pinfl: string; firm: string; address: string;
  hasCase: boolean;       // pipeline'da case bor
  hasPortfolio: boolean;  // portfelda (Loan) bor
  hasScan: boolean;       // imzolangan skani saqlangan (yuklab olsa boʻladi)
}
export interface PalataScanSummary {
  total: number;          // skandan oʻqilgan arizalar
  matched: number;        // portfelda topilgani (PINFL mos)
  withCase: number;       // pipeline'da case bori
  noCase: number;         // case yoʻq (masalan excluded=false)
  firms: FirmScanStat[];  // firma boʻyicha
  arizas: ScanRow[];      // batafsil roʻyxat (case yoʻqlar oldinda)
  updatedAt: string | null;
}

export function readScannedArizas(): ScannedAriza[] {
  try { return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')); } catch { return []; }
}

export async function palataScanSummary(): Promise<PalataScanSummary> {
  const rows = readScannedArizas();
  const stat = fs.existsSync(DATA_PATH) ? fs.statSync(DATA_PATH).mtime.toISOString() : null;
  if (rows.length === 0) return { total: 0, matched: 0, withCase: 0, noCase: 0, firms: [], arizas: [], updatedAt: stat };

  const pinfls = [...new Set(rows.map((r) => r.pinfl).filter(Boolean))];
  const [loans, cases, firms] = await Promise.all([
    // Keep the (pinfl, branchCode) pair — a client may have loans at several firms,
    // so we match the ariza's firm, not an arbitrary one.
    prisma.loan.findMany({ where: { pinfl: { in: pinfls } }, select: { pinfl: true, branchCode: true }, distinct: ['pinfl', 'branchCode'] }),
    prisma.arizaCase.findMany({ where: { pinfl: { in: pinfls } }, select: { pinfl: true, firmId: true } }),
    prisma.firm.findMany({ select: { id: true, code: true, shortName: true } }),
  ]);
  const firmByKey = (key: string) => firms.find((f) => (f.shortName || '').toUpperCase().includes(key));
  const loanPairs = new Set(loans.map((l) => `${l.pinfl}::${l.branchCode}`));
  const casePairs = new Set(cases.map((c) => `${c.pinfl}::${c.firmId}`));

  const per = new Map<string, FirmScanStat>();
  const arizas: ScanRow[] = [];
  let matched = 0, withCase = 0;
  for (const r of rows) {
    const firm = firmByKey(r.firmKey);
    const label = firm?.shortName || r.firmKey || 'Nomaʼlum';
    // Client exists at THIS firm's portfolio, and has a pipeline case at THIS firm.
    const inPortfolio = firm ? loanPairs.has(`${r.pinfl}::${firm.code}`) : false;
    const inPipeline = firm ? casePairs.has(`${r.pinfl}::${firm.id}`) : false;
    if (inPortfolio) matched++;
    if (inPipeline) withCase++;
    const s = per.get(label) ?? { firm: label, total: 0, matched: 0, withCase: 0 };
    s.total++; if (inPortfolio) s.matched++; if (inPipeline) s.withCase++;
    per.set(label, s);
    arizas.push({ reg: r.reg, name: r.name, pinfl: r.pinfl, firm: label, address: r.address || '', hasCase: inPipeline, hasPortfolio: inPortfolio, hasScan: !!r.source });
  }
  // Case yoʻqlar (eʼtibor talab qiladiganlar) roʻyxat boshida; soʻng firma + ism.
  arizas.sort((a, b) => Number(a.hasCase) - Number(b.hasCase) || a.firm.localeCompare(b.firm) || a.name.localeCompare(b.name));
  return {
    total: rows.length, matched, withCase, noCase: rows.length - withCase,
    firms: [...per.values()].sort((a, b) => b.total - a.total),
    arizas,
    updatedAt: stat,
  };
}
