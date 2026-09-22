import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { getT } from '@/lib/i18n/server';
import { BUYRUQ_STATUSES, STATUS_UZ } from '@/lib/sud-buyruq';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// «Sud buyrug'i» — ADOLAT holatlari bo'yicha ishlarni tanlab, buyruq-formatida Excel yuklab olish
// sahifasi. Firma × holat kesimi (nechta ish) ko'rsatiladi; tanlov download route'ga GET bilan boradi.
export default async function BuyruqPage() {
  await requireAccess('sud:send');
  const t = getT();
  const firms = await prisma.firm.findMany({ where: { active: true }, select: { code: true, shortName: true }, orderBy: { id: 'asc' } });
  const grouped = await prisma.clientCaseStatus.groupBy({
    by: ['branchCode', 'status'],
    where: { source: 'CABINET', status: { in: BUYRUQ_STATUSES } },
    _count: { _all: true },
  });
  const countOf = (code: string, st: string) => grouped.find((g) => g.branchCode === code && g.status === st)?._count._all ?? 0;
  const defaults = new Set(['REGISTER', 'ALLOCATE', 'PENDING', 'IN_PROCESS']);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <h1 className="text-lg font-semibold text-fg">{t('Sud buyrugʻi — Excel')}</h1>
      <p className="mt-1 text-sm text-muted">
        {t('Firma va holatlarni tanlab, sudga topshiriladigan buyruq roʻyxatini (asosiy qarz + davlat boji 4%, manzil/pasport/JSHSHIR) Excel qilib yuklab oling.')}
      </p>

      {/* «Namunani to'ldirish» — foydalanuvchi o'zining shablon Excel'ini yuklaydi, tizim ismi bo'yicha
          portfelga solishtirib Da'vo summasi / manzil / pasport / JSHSHIR / bojini to'ldirib qaytaradi.
          Original ustunlar/formatlar saqlanadi (Буйрук уч намуна ...xlsx bilan mos). */}
      <div className="mt-4 rounded-xl border border-line bg-surface-2/40 p-3">
        <div className="text-sm font-semibold text-fg">{t('Namunani toʻldirish (upload)')}</div>
        <p className="mt-1 text-xs text-muted">
          {t('Buyruq shabloningizni (.xlsx) yuklang — Javobgar ustunidagi ismlarga qarab portfelga solishtiriladi va Daʼvo summasi (asosiy qarz) + davlat boji (4%) + manzil + pasport + JSHSHIR toʻldirilgan Excel qaytariladi.')}
        </p>
        <form action="/sud/buyruq/fill" method="post" encType="multipart/form-data" className="mt-2 flex flex-wrap items-center gap-2">
          <input type="file" name="file" accept=".xlsx" required className="text-sm" />
          <select name="firm" className="field-input">
            <option value="">{t('Barcha firmalar boʻyicha qidirish')}</option>
            {firms.map((f) => <option key={f.code} value={f.code}>{f.shortName}</option>)}
          </select>
          <button type="submit" className="btn-primary">{t('Toʻldirib olish')}</button>
        </form>
      </div>

      <div className="mt-6 text-sm font-semibold text-fg">{t('Yoki holat boʻyicha yangi Excel yaratish')}</div>
      <form action="/sud/buyruq/export" method="get" className="mt-2 space-y-4">
        <fieldset className="rounded-xl border border-line p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">{t('Firma')}</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {firms.map((f) => (
              <label key={f.code} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="firm" value={f.code} defaultChecked />
                <span className="text-fg">{f.shortName}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="rounded-xl border border-line p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">{t('Holat')}</legend>
          <div className="grid grid-cols-2 gap-x-5 gap-y-2 sm:grid-cols-3">
            {BUYRUQ_STATUSES.map((st) => {
              const total = firms.reduce((s, f) => s + countOf(f.code, st), 0);
              return (
                <label key={st} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="status" value={st} defaultChecked={defaults.has(st)} />
                  <span className="text-fg">{STATUS_UZ[st]}</span>
                  <span className="ml-auto tabular-nums text-xs text-muted">{total.toLocaleString()}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <button type="submit" className="btn-primary">{t('Excel yuklab olish')}</button>
      </form>

      <div className="mt-6 overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface-2 text-left text-xs text-muted">
              <th className="p-2 font-semibold">{t('Firma')}</th>
              {BUYRUQ_STATUSES.map((st) => (
                <th key={st} className="p-2 text-right font-semibold">{STATUS_UZ[st]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {firms.map((f) => (
              <tr key={f.code} className="border-t border-line">
                <td className="p-2 text-fg">{f.shortName}</td>
                {BUYRUQ_STATUSES.map((st) => {
                  const n = countOf(f.code, st);
                  return <td key={st} className="p-2 text-right tabular-nums text-muted">{n ? n.toLocaleString() : '—'}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
