// Cabinet-driven «qaytganlar»: clients whose cabinet.sud.uz OUTCOME is RETURNED/REFUSED/UNCONSIDERED
// (from ClientCaseStatus, source CABINET) — the real court returns, independent of our internal
// arizaCase.stage (which may not have been advanced to COURT_RETURNED). These need the ariza fixed
// and re-filed. Read-only aggregation for the «Qaytganlar» page + its Excel export.
import { prisma } from './db';
import { COURT_RESULT_UZ } from './court-result';
import { snapshotCourtScope, uniqueClaims } from './court-scope';

const BAD = ['RETURNED', 'REFUSED', 'UNCONSIDERED', 'WITHDRAWN'];

export interface CabinetReturn {
  pinfl: string | null;
  clientName: string;
  branchCode: string;
  firmName: string;
  caseNumber: string | null;
  result: string;         // raw cabinet code
  resultLabel: string;    // Uzbek
  definitionDate: string | null; // ajrim sanasi
  registryNumber: string | null; // ish/registratsiya raqami (detail.registry_number)
  registryDt: string | null;     // ro'yxatga olingan sana (detail.registry_dt)
}

// Snapshot berilsa — faqat SHU snapshotdan sudga yuborilgan ishlarning qaytishlari (court-scope.ts: sud
// navbati bo'yicha, Hisobot «Qaytarilgan» bilan bir xil qoida; ClientCaseStatus.snapshotId'ga tayanilmaydi).
// Berilmasa — hamma qaytgan ishlar. Bitta da'vo — bitta qator (uniqueClaims). Firma (branchCode) filtri ham.
export async function cabinetReturnedCases(snapshotId?: number, firmId?: number): Promise<CabinetReturn[]> {
  let branchCode: string | undefined;
  if (firmId) {
    const f = await prisma.firm.findUnique({ where: { id: firmId }, select: { code: true } });
    branchCode = f?.code ?? '__none__'; // a real firm with no code → match nothing rather than all
  }

  const scope = await snapshotCourtScope(snapshotId);
  const all = await prisma.clientCaseStatus.findMany({
    where: {
      source: 'CABINET',
      caseResult: { in: BAD },
      ...(branchCode ? { branchCode } : {}),
      ...(scope ? { pinfl: { in: scope.pinfls } } : {}),
    },
    select: { pinfl: true, clientName: true, branchCode: true, caseNumber: true, caseResult: true, detail: true, claimId: true, registryDt: true, createdAt: true },
    orderBy: { updatedAt: 'desc' },
  });
  const inScope = scope ? all.filter((r) => scope.has(r)) : all;
  // Egizak qatorlardan detail'i (ajrim sanasi, ish raqami) borini qoldiramiz; tartib — updatedAt bo'yicha.
  const keep = new Set(uniqueClaims([...inScope].sort((a, b) => Number(!!b.detail) - Number(!!a.detail))));
  const rows = inScope.filter((r) => keep.has(r));

  const codes = [...new Set(rows.map((r) => r.branchCode))];
  const firms = await prisma.firm.findMany({ where: { code: { in: codes } }, select: { code: true, shortName: true } });
  const nameByCode = new Map(firms.map((f) => [f.code, f.shortName]));

  return rows.map((r) => {
    const d = r.detail as any;
    return {
      pinfl: r.pinfl,
      clientName: r.clientName,
      branchCode: r.branchCode,
      firmName: nameByCode.get(r.branchCode) ?? r.branchCode,
      caseNumber: r.caseNumber,
      result: r.caseResult ?? '',
      resultLabel: COURT_RESULT_UZ[r.caseResult ?? ''] ?? r.caseResult ?? '',
      definitionDate: d?.definition_date ?? null,
      registryNumber: d?.registry_number ?? null,
      registryDt: d?.registry_dt ?? null,
    };
  });
}
