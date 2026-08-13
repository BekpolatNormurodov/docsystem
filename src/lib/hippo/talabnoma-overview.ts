// «Umumiy talabnoma reyestri» — a management overview Excel across EVERY firm of one
// snapshot, so the operator sees the whole talabnoma picture in one file and can filter
// by firm and by count directly in Excel. Two sheets:
//   · «Firmalar»          — one row per firm: talabnoma count (debt>0), skipped 0-debt,
//                           total clients, total debt/credit — with a JAMI total row.
//   · «Barcha talabnomalar» — every talabnoma row of every firm, with a leading «Firma»
//                           column + an autofilter, so «filter by firm / by count» is native.
//
// This is a READ-ONLY overview: the per-firm reyestr that xat.hippo actually imports stays the
// per-firm `talabnoma-bulk-excel` (a mixed-firm reyestr is not importable). Reuses the SAME
// debt-gated grouping (loadTalabnomaRowsForScope) so the numbers match the per-firm exports.
import ExcelJS from 'exceljs';
import { prisma } from '@/lib/db';
import { loadTalabnomaRowsForScope } from './talabnoma-bulk';
import type { TalabnomaRow } from './talabnoma-excel';

export interface FirmOverview {
  firmId: number;
  firmName: string;
  clients: number;        // distinct konveyer clients of this firm in the snapshot
  talabnomaCount: number; // debt>0 grouped rows — the letters that would be sent
  zeroDebt: number;       // clients with no outstanding debt — no talabnoma (skipped)
  totalDebt: number;      // Σ Jami qarzdorlik over the talabnoma rows
  totalLoan: number;      // Σ Kredit miqdori over the talabnoma rows
}

export interface TalabnomaOverview {
  reportDate: Date | null;
  firms: FirmOverview[];
  rowsByFirm: { firmName: string; rows: TalabnomaRow[] }[];
  totals: { firmCount: number; clients: number; talabnomaCount: number; zeroDebt: number; totalDebt: number; totalLoan: number };
}

// Build the cross-firm overview for one snapshot. Iterates the snapshot's firms and reuses the
// per-firm debt-gated loader, so a firm with only 0-debt clients contributes a row with
// talabnomaCount 0 (visible as «hammasi to'langan»), never a phantom letter.
export async function buildTalabnomaOverview(snapshotId: number): Promise<TalabnomaOverview> {
  const snapshot = await prisma.snapshot.findUnique({ where: { id: snapshotId }, select: { reportDate: true } });

  // Firms that actually have konveyer cases in this snapshot, with their client counts.
  // (ArizaCase.firmId is a required Int, so every group has a real firm.)
  const grouped = await prisma.arizaCase.groupBy({
    by: ['firmId'],
    where: { snapshotId },
    _count: true,
  });
  const firmIds = grouped.map((g) => g.firmId);
  const clientsByFirm = new Map<number, number>(grouped.map((g) => [g.firmId, g._count]));
  const firmRows = await prisma.firm.findMany({ where: { id: { in: firmIds } }, select: { id: true, shortName: true, legalName: true, code: true } });
  const nameById = new Map(firmRows.map((f) => [f.id, f.shortName || f.legalName || f.code || `firma-${f.id}`]));

  const firms: FirmOverview[] = [];
  const rowsByFirm: { firmName: string; rows: TalabnomaRow[] }[] = [];

  // Sequential per firm — each call is a scoped loan query; a dozen firms is cheap and keeps
  // memory flat vs. loading every firm's loans at once. A single firm's failure (missing firm)
  // must not sink the whole overview, so it's caught and recorded as an empty firm.
  for (const firmId of firmIds) {
    const firmName = nameById.get(firmId) ?? `firma-${firmId}`;
    const clients = clientsByFirm.get(firmId) ?? 0;
    let rows: TalabnomaRow[] = [];
    try {
      ({ rows } = await loadTalabnomaRowsForScope({ snapshotId, firmId }));
    } catch {
      rows = [];
    }
    const totalDebt = rows.reduce((s, r) => s + r.total_debt, 0);
    const totalLoan = rows.reduce((s, r) => s + r.loan_amount, 0);
    firms.push({
      firmId, firmName, clients,
      talabnomaCount: rows.length,
      zeroDebt: Math.max(0, clients - rows.length),
      totalDebt, totalLoan,
    });
    if (rows.length) rowsByFirm.push({ firmName, rows });
  }

  // Biggest talabnoma batches first — the operator's attention goes to the firms with the most to send.
  firms.sort((a, b) => b.talabnomaCount - a.talabnomaCount);
  rowsByFirm.sort((a, b) => b.rows.length - a.rows.length);

  const totals = firms.reduce(
    (t, f) => ({
      firmCount: t.firmCount + 1,
      clients: t.clients + f.clients,
      talabnomaCount: t.talabnomaCount + f.talabnomaCount,
      zeroDebt: t.zeroDebt + f.zeroDebt,
      totalDebt: t.totalDebt + f.totalDebt,
      totalLoan: t.totalLoan + f.totalLoan,
    }),
    { firmCount: 0, clients: 0, talabnomaCount: 0, zeroDebt: 0, totalDebt: 0, totalLoan: 0 },
  );

  return { reportDate: snapshot?.reportDate ?? null, firms, rowsByFirm, totals };
}

const MONEY = '#,##0';
const dmy = (d: Date | null) =>
  d ? `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}` : '';

// Render the overview to a two-sheet workbook buffer.
export async function talabnomaOverviewBuffer(ov: TalabnomaOverview): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  // ── Sheet 1: Firmalar (summary) ──────────────────────────────────────────
  const s1 = wb.addWorksheet('Firmalar');
  s1.columns = [
    { header: 'Firma', key: 'firma', width: 34 },
    { header: 'Talabnoma (soni)', key: 'count', width: 16 },
    { header: '0 so‘m (chiqmaydi)', key: 'zero', width: 18 },
    { header: 'Jami mijoz', key: 'clients', width: 12 },
    { header: 'Jami qarzdorlik (so‘m)', key: 'debt', width: 22 },
    { header: 'Jami kredit (so‘m)', key: 'loan', width: 20 },
  ];
  s1.getRow(1).font = { bold: true };
  for (const f of ov.firms) {
    s1.addRow({ firma: f.firmName, count: f.talabnomaCount, zero: f.zeroDebt, clients: f.clients, debt: f.totalDebt, loan: f.totalLoan });
  }
  const totalRow = s1.addRow({
    firma: 'JAMI', count: ov.totals.talabnomaCount, zero: ov.totals.zeroDebt,
    clients: ov.totals.clients, debt: ov.totals.totalDebt, loan: ov.totals.totalLoan,
  });
  totalRow.font = { bold: true };
  s1.getColumn('debt').numFmt = MONEY;
  s1.getColumn('loan').numFmt = MONEY;
  s1.getColumn('count').numFmt = '#,##0';
  s1.autoFilter = { from: 'A1', to: 'F1' };
  s1.views = [{ state: 'frozen', ySplit: 1 }];

  // ── Sheet 2: Barcha talabnomalar (every row, firm-tagged, filterable) ─────
  const s2 = wb.addWorksheet('Barcha talabnomalar');
  s2.columns = [
    { header: 'Firma', key: 'firma', width: 28 },
    { header: 'PINFL', key: 'pinfl', width: 16 },
    { header: 'Sana', key: 'date', width: 12 },
    { header: 'Shartnoma ID', key: 'cid', width: 14 },
    { header: 'Qarzdor FISH', key: 'receiver', width: 34 },
    { header: 'Manzil', key: 'address', width: 40 },
    { header: 'Shartnoma raqami', key: 'cnum', width: 18 },
    { header: 'Kredit miqdori', key: 'loan', width: 16 },
    { header: 'Jami qarzdorlik', key: 'debt', width: 18 },
  ];
  s2.getRow(1).font = { bold: true };
  // PINFL as TEXT — a 14-digit id must not be mangled into scientific notation by Excel.
  s2.getColumn('pinfl').numFmt = '@';
  for (const { firmName, rows } of ov.rowsByFirm) {
    for (const r of rows) {
      s2.addRow({
        firma: firmName, pinfl: r.pinfl ?? '', date: dmy(r.date), cid: r.contract_id, receiver: r.receiver,
        address: r.address, cnum: r.contract_number, loan: r.loan_amount, debt: r.total_debt,
      });
    }
  }
  s2.getColumn('loan').numFmt = MONEY;
  s2.getColumn('debt').numFmt = MONEY;
  const lastRow = s2.rowCount;
  s2.autoFilter = { from: 'A1', to: `I${Math.max(1, lastRow)}` };
  s2.views = [{ state: 'frozen', ySplit: 1 }];

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
