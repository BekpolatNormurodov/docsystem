import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { getT } from '@/lib/i18n/server';
import { resolveBuyruqSnapshot } from '@/lib/sud-buyruq';
import UploadCard from './UploadCard';

const dmy = (d: Date) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;

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
  // Qaysi portfel bo'yicha to'ldiriladi — tepadagi sanadan tanlangan snapshot (fill route bilan bir xil qoida).
  const v = cookies().get('konv_s')?.value;
  const snap = await resolveBuyruqSnapshot(v && /^\d+$/.test(v) ? Number(v) : undefined).catch(() => null);
  const latest = await prisma.snapshot.findFirst({ orderBy: { reportDate: 'desc' }, select: { id: true } }).catch(() => null);

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

      {/* Qaysi portfel ishlatilishi — ochiq ko'rsatiladi (tepadagi sana almashtirilsa shu ham o'zgaradi). */}
      {snap && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-brand-500/25 bg-brand-500/[0.05] px-4 py-2.5 text-sm">
          <svg className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3" y="4.5" width="18" height="16" rx="2.5" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4" /></svg>
          <span className="text-muted">{t('Portfel (qarz/manzil shu sanadan olinadi)')}:</span>
          <b className="tabular-nums text-fg">{dmy(snap.reportDate)}</b>
          {latest && latest.id !== snap.id && (
            <span className="rounded-md bg-amber-500/12 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">{t('eng soʻnggisi emas')}</span>
          )}
          <span className="ml-auto text-xs text-muted">{t('sanani yuqoridan almashtiring')}</span>
        </div>
      )}

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
