// Talabnoma «boshqaruv tabligi» — sahifa tepasidagi KPI plitalari + firma×holat jadvali uchun
// bir snapshot bo'yicha HAR FAOL firma raqamlari. Raqamlar aynan reyestr eksporti bilan bir xil
// manbadan (loadTalabnomaRowsForScope — qarz>0 guruhlash) va «iz» (getSentTalabnomaPinfls) bo'yicha
// yuborilgan/qolganga bo'linadi — ya'ni panel va Excel bilan mos. NOFAOL firma umuman kirmaydi
// (firmActivity — Feature B): nofaol firmaning talabnoma sonlari hech qayerda ko'rinmaydi.
import { prisma } from '@/lib/db';
import { loadTalabnomaRowsForScope } from './talabnoma-bulk';
import { getSentTalabnomaPinfls, splitBySent } from './talabnoma-trace';

// NB: `firmActivity()` (active-firms.ts) React `cache()`ga tayanadi — u RSC uchun, ROUTE HANDLER'da
// ishonchsiz (bu tablo route'dan chaqiriladi va u yerda 0 firma qaytardi). Shu sabab bu yerda faol
// firmalarni TO'G'RIDAN-TO'G'RI so'raymiz — har runtime'da (route/worker/RSC) bir xil, aniq.

export interface TalabnomaFirmRow {
  firmId: number;
  firmName: string;
  clients: number;   // snapshotdagi konveyer mijozlari (ArizaCase)
  toSend: number;    // qarz>0 talabnoma (yuboriladigan jami)
  sent: number;      // «iz» bo'yicha allaqachon xat.hippo'ga yuborilgan
  remaining: number; // hali yuborilmagan (toSend - sent)
  totalDebt: number; // Σ jami qarzdorlik (talabnoma qatorlari bo'yicha)
}
export interface TalabnomaBoard {
  firms: TalabnomaFirmRow[];
  totals: { firmCount: number; clients: number; toSend: number; sent: number; remaining: number; totalDebt: number };
}

export async function talabnomaBoard(snapshotId: number): Promise<TalabnomaBoard> {
  // FAOL firmalar (nofaol chiqmaydi) — to'g'ridan-to'g'ri so'rov.
  const activeSet = new Set((await prisma.firm.findMany({ where: { active: true }, select: { id: true } })).map((f) => f.id));

  // Snapshotda ishi (ArizaCase) bor firmalar + mijoz soni → faqat faollari.
  const grouped = await prisma.arizaCase.groupBy({ by: ['firmId'], where: { snapshotId }, _count: true });
  const clientsByFirm = new Map<number, number>(grouped.map((g) => [g.firmId, g._count]));
  const firmIds = grouped.map((g) => g.firmId).filter((id) => activeSet.has(id));
  const firmRows = firmIds.length
    ? await prisma.firm.findMany({ where: { id: { in: firmIds } }, select: { id: true, shortName: true, legalName: true, code: true } })
    : [];
  const nameById = new Map(firmRows.map((f) => [f.id, f.shortName || f.legalName || f.code || `firma-${f.id}`]));

  // Ketma-ket — har firma alohida scoped so'rov; ~10 firma arzon va xotira tekis (Excel overview kabi).
  const firms: TalabnomaFirmRow[] = [];
  for (const f of firmRows) {
    let toSend = 0, sent = 0, remaining = 0, totalDebt = 0;
    try {
      const { rows, branchCode } = await loadTalabnomaRowsForScope({ snapshotId, firmId: f.id });
      const sentSet = branchCode ? await getSentTalabnomaPinfls(snapshotId, branchCode) : new Set<string>();
      const split = splitBySent(rows, sentSet);
      toSend = rows.length;
      sent = split.sentCount;
      remaining = split.remaining.length;
      totalDebt = rows.reduce((s, r) => s + r.total_debt, 0);
    } catch { /* bitta firma yiqilsa — bo'sh qator, butun tablo yiqilmasin */ }
    firms.push({ firmId: f.id, firmName: nameById.get(f.id) ?? `firma-${f.id}`, clients: clientsByFirm.get(f.id) ?? 0, toSend, sent, remaining, totalDebt });
  }

  // Eng ko'p yuboriladigan firma tepada — operator e'tibori shu yerda.
  firms.sort((a, b) => b.toSend - a.toSend || b.totalDebt - a.totalDebt);

  const totals = firms.reduce(
    (t, f) => ({
      firmCount: t.firmCount + 1,
      clients: t.clients + f.clients,
      toSend: t.toSend + f.toSend,
      sent: t.sent + f.sent,
      remaining: t.remaining + f.remaining,
      totalDebt: t.totalDebt + f.totalDebt,
    }),
    { firmCount: 0, clients: 0, toSend: 0, sent: 0, remaining: 0, totalDebt: 0 },
  );
  return { firms, totals };
}
