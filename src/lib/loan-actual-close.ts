// Kreditning HAQIQIY yopilish sanasini (portfeldagi `date_actu_close`) tiklash.
//
// NEGA: grafik va oferta muddati `loanMaturity()` dan olinadi — u `raw.date_actu_close` ni
// ishlatadi, yo'q bo'lsa `dateClose` ga tushadi. `dateClose` esa kredit LINIYASINING uzoq
// muddati («3-Долгосрочные» — 72 oy), haqiqiy muddat emas. 2026-09-18: snapshot 5 (joriy
// portfel) eksportida `date_actu_close` ustuni UMUMAN yo'q (103 349 kreditdan 0 ta), snapshot 1
// da esa hammasida bor. Natijada joriy ishlarning grafigi 72 oylik chiqardi — ba'zi oylarda
// «asosiy qarz» manfiy, qoldiq o'sadi (62% da 31 kunlik oy foizi to'lovdan oshadi).
//
// Shartnoma raqami (ldId) + firma kodi (branchCode) snapshotlar orasida barqaror — o'sha
// shartnomaning boshqa snapshotdagi `date_actu_close` qiymati olinadi (~97% kreditda bor).
// Faqat o'qiydi; kiruvchi obyektlar o'zgartirilmaydi (nusxa qaytadi).
import { prisma } from './db';

type LoanLike = { ldId: string | null; branchCode?: string | null; raw?: unknown };

/** Kreditda haqiqiy yopilish sanasi (`raw.date_actu_close`) bormi — oferta/grafik muddati shundan. */
export const hasActualClose = (raw: unknown) => hasActu(raw);

function hasActu(raw: unknown): boolean {
  const v = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).date_actu_close : undefined;
  return v != null && v !== '' && Number(v) > 0;
}

/** `raw.date_actu_close` bo'lmagan kreditlarga uni boshqa snapshotdagi o'sha shartnomadan qo'yadi.
 *  Topilmaganlari o'zgarmay qoladi (grafik-pdf qat'iy rejimda ularni tashlab ketadi). */
export async function withActualClose<T extends LoanLike>(loans: T[]): Promise<T[]> {
  const need = loans.filter((l) => l.ldId && l.branchCode && !hasActu(l.raw));
  if (!need.length) return loans;
  const found = new Map<string, unknown>();
  const byBranch = new Map<string, string[]>();
  for (const l of need) {
    const b = String(l.branchCode);
    if (!byBranch.has(b)) byBranch.set(b, []);
    byBranch.get(b)!.push(String(l.ldId));
  }
  for (const [branchCode, ldIds] of byBranch) {
    const rows = await prisma.loan.findMany({
      where: { branchCode, ldId: { in: [...new Set(ldIds)] } },
      select: { ldId: true, raw: true },
      orderBy: { snapshotId: 'desc' }, // eng yangi snapshotdagi qiymat ustun
    });
    for (const r of rows) {
      const k = `${branchCode}|${r.ldId}`;
      if (!found.has(k) && hasActu(r.raw)) found.set(k, (r.raw as Record<string, unknown>).date_actu_close);
    }
  }
  return loans.map((l) => {
    const v = found.get(`${l.branchCode}|${l.ldId}`);
    if (v == null || hasActu(l.raw)) return l;
    const raw = l.raw && typeof l.raw === 'object' ? { ...(l.raw as Record<string, unknown>) } : {};
    return { ...l, raw: { ...raw, date_actu_close: v } };
  });
}
