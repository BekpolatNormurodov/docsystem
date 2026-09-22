import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { getT } from '@/lib/i18n/server';
import { BUYRUQ_STATUSES, STATUS_UZ } from '@/lib/sud-buyruq';
import UploadCard from './UploadCard';
import StatusExportForm from './StatusExportForm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Har holat uchun ranglar (chip dot) — sudda/qaror/rad guruhlariga ko'ra ajratamiz.
// Semantic tokens'ga bog'lay olmaymiz (chip dot dinamik) — shuning uchun bevosita hex.
const STATUS_DOT: Record<string, string> = {
  CREATED: '#94A3B8',       // slate-400 — hali yuborilmagan
  REGISTER: '#10B981',      // emerald-500 — ro'yxatdan o'tgan (yangi kirdi)
  ALLOCATE: '#0EA5E9',      // sky-500 — sudyaga taqsimlangan
  PENDING: '#F59E0B',       // amber-500 — kutmoqda
  IN_PROCESS: '#8B5CF6',    // violet-500 — ko'rilmoqda
  DECIDED: '#22C55E',       // green-500 — qaror bor
  FINISHED: '#059669',      // emerald-600 — yakunlangan
  DECLINED: '#EF4444',      // red-500 — rad etilgan
  RETURNED: '#F97316',      // orange-500 — qaytarilgan
};

/**
 * «Sud buyrug'i» — Excel yordamchisi. Ikki oqim:
 *   1) Namunani to'ldirish (upload) — foydalanuvchining Буйрук .xlsx shabloni.
 *   2) Holat bo'yicha yangi Excel — ADOLAT holatlariдан tanlab (chiplar bilan).
 */
export default async function BuyruqPage() {
  await requireAccess('sud-buyruq');
  const t = getT();
  const firms = await prisma.firm.findMany({ where: { active: true }, select: { code: true, shortName: true }, orderBy: { id: 'asc' } });
  const grouped = await prisma.clientCaseStatus.groupBy({
    by: ['branchCode', 'status'],
    where: { source: 'CABINET', status: { in: BUYRUQ_STATUSES } },
    _count: { _all: true },
  });

  // matrix[firm.code][status] = count — client komponentga uzatiladi (real vaqtli «tanlangan» ko'rsatkichi).
  const matrix: Record<string, Record<string, number>> = {};
  for (const g of grouped) {
    (matrix[g.branchCode] ??= {})[g.status] = g._count._all;
  }
  const statusItems = BUYRUQ_STATUSES.map((st) => ({
    key: st,
    label: STATUS_UZ[st] ?? st,
    dot: STATUS_DOT[st],
    total: grouped.filter((g) => g.status === st).reduce((s, g) => s + g._count._all, 0),
  }));

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      {/* Sarlavha bloki — bo'lim tavsifi va rang shkala legendasi.  */}
      <header className="mb-5">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-emerald-100 p-2 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 22h16"/><path d="M12 2v20"/><path d="M4 8h16"/><path d="M6 8v14"/><path d="M18 8v14"/></svg>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-fg">{t('Sud buyrugʻi — Excel')}</h1>
            <p className="text-sm text-muted">
              {t('Buyruq roʻyxatini asosiy qarz + davlat boji (4%) + manzil/pasport/JSHSHIR bilan tayyorlash.')}
            </p>
          </div>
        </div>
      </header>

      {/* 1. Upload karta */}
      <UploadCard firms={firms} />

      {/* 2. Holat bo'yicha yangi Excel */}
      <section className="mt-6 rounded-2xl border border-line bg-surface p-4">
        <header className="flex items-center gap-2">
          <div className="rounded-lg bg-sky-100 p-1.5 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-fg">{t('Yoki holat boʻyicha yangi Excel yaratish')}</h2>
            <p className="text-xs text-muted">{t('Firma va holatlarni tanlang — tanlangan ishlar soni jonli koʻrsatiladi.')}</p>
          </div>
        </header>
        <StatusExportForm firms={firms} statuses={statusItems} matrix={matrix} />
      </section>

      {/* 3. Kesim jadvali — professional table (kompakt, zebra, sticky header) */}
      <section className="mt-6">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{t('Barcha ishlar — firma × holat')}</h3>
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-surface-2/60">
              <tr className="text-left text-xs text-muted">
                <th className="sticky left-0 z-10 bg-surface-2/60 px-3 py-2 font-semibold">{t('Firma')}</th>
                {BUYRUQ_STATUSES.map((st) => (
                  <th key={st} className="whitespace-nowrap px-3 py-2 text-right font-semibold">
                    <span className="inline-flex items-center gap-1.5 justify-end">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: STATUS_DOT[st] }} aria-hidden="true" />
                      <span>{STATUS_UZ[st]}</span>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {firms.map((f, idx) => (
                <tr key={f.code} className={idx % 2 ? 'bg-surface-2/20' : ''}>
                  <td className="sticky left-0 bg-inherit px-3 py-2 font-medium text-fg">{f.shortName}</td>
                  {BUYRUQ_STATUSES.map((st) => {
                    const n = matrix[f.code]?.[st] ?? 0;
                    return (
                      <td key={st} className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${n ? 'text-fg' : 'text-muted/50'}`}>
                        {n ? n.toLocaleString() : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
