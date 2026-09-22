import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { getT } from '@/lib/i18n/server';
import UploadCard from './UploadCard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * «Sud buyrug'i» — Excel yordamchisi. Yagona oqim: foydalanuvchi Буйрук namunasini
 * (.xlsx) yuklaydi → tizim Javobgar ismi bo'yicha portfelga solishtirib Da'vo summasi
 * (asosiy qarz), davlat boji (4%), manzil, tug'ilgan (PINFL'dan), pasport va JSHSHIR
 * ni to'ldirib qaytaradi. Original ustunlar va formatlar saqlanadi. ADOLAT holatlari
 * kesimi/jadvali bu yerda YO'Q (foydalanuvchi so'rovi: «ortiqcha data kerakmas»).
 */
export default async function BuyruqPage() {
  await requireAccess('sud-buyruq');
  const t = getT();
  const firms = await prisma.firm.findMany({ where: { active: true }, select: { code: true, shortName: true }, orderBy: { id: 'asc' } });

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-emerald-100 p-2.5 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 22h16"/><path d="M12 2v20"/><path d="M4 8h16"/><path d="M6 8v14"/><path d="M18 8v14"/></svg>
          </div>
          <div>
            <h1 className="text-xl font-semibold text-fg">{t('Sud buyrugʻi — Excel')}</h1>
            <p className="mt-0.5 text-sm text-muted">
              {t('Namuna Excelni yuklang — asosiy qarz + davlat boji (4%) + manzil/pasport/JSHSHIR toʻldirilgan Excel qaytariladi.')}
            </p>
          </div>
        </div>
      </header>

      <UploadCard firms={firms} />

      {/* Qisqa qo'llanma — foydalanuvchi qaysi ustunlar avtomatik to'lishini bilsin. */}
      <aside className="mt-4 rounded-xl border border-line bg-surface-2/40 px-4 py-3 text-xs text-muted">
        <div className="mb-1 font-semibold text-fg">{t('Excel ustunlari (1-qator — sarlavha):')}</div>
        <ul className="ml-4 list-disc space-y-0.5">
          <li>
            <b className="text-fg">{t('Javobgar')}</b> — {t('shu ustundagi ismlarga qarab qidiradi (majburiy).')}
          </li>
          <li>{t('Avtomatik toʻladi (agar boʻsh boʻlsa)')}: <span className="text-fg">MANZILI, Tugilgan kun oy yil, Pasport, JSHSHIR, Daʼvo summasi</span></li>
          <li>{t('Boji')} <b className="text-fg">= Daʼvo summasi × 4%</b> {t('(formula shablonda boʻlsa saqlanadi).')}</li>
        </ul>
      </aside>
    </div>
  );
}
