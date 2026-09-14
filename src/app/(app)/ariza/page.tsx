import Link from 'next/link';
import { requireAccess } from '@/lib/auth';
import { getT } from '@/lib/i18n/server';
import { loadStageData } from '../konveyer/stage-data';
import { StageView } from '../konveyer/StageView';

export const dynamic = 'force-dynamic';

// Sanoat palatasi → «Ariza yuborish» sub-item. The StageView's Mijozlar section carries the
// «Tayyorlash» ZIP export (Hisobot-style) + the case list. Scanning is the /ariza/skaner sub-page.
export default async function ArizaPage({ searchParams }: { searchParams: { s?: string } }) {
  const t = getT();
  await requireAccess('ariza:prepare');
  const d = await loadStageData('SIGN', searchParams.s);

  // Ariza YASALISH FORMULASI sud ro'yxatiga bog'liq: bu bosqich shu ro'yxatdagi (sudga chiqadigan)
  // mijozlarga ariza yasaydi. Ro'yxat yo'q bo'lsa (konveyerda case yo'q) — arizani tayyorlash o'rniga
  // sud ro'yxatini so'raymiz (Hujjatlar → portfel + sud ro'yxati). Bo'lsa — StageView, formula ishlaydi.
  if (d.total === 0) {
    return (
      <div className="space-y-5">
        <h1 className="text-2xl font-bold tracking-tight">{t('Sanoat palatasi — arizani tayyorlash')}</h1>
        <div className="max-w-2xl rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-6">
          <div className="flex items-start gap-3.5">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-300" aria-hidden>
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18" /><path d="m12 3 8 4v2H4V7l8-4z" /><path d="M6 11v6M10 11v6M14 11v6M18 11v6" /></svg>
            </span>
            <div>
              <h2 className="text-base font-semibold">{t('Avval sud ro‘yxati kerak')}</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                {t('Arizalar')} <b className="text-fg">{t('sud ro‘yxatidagi')}</b> {t('(sudga chiqadigan) mijozlarga yasaladi. Hozircha bu snapshotda sud ro‘yxati yo‘q.')} <b className="text-fg">{t('Hujjatlar')}</b> {t('bo‘limidan portfel bilan birga')} <b className="text-fg">{t('sud ro‘yxatini (.xlsx)')}</b> {t('yuklang — shundan keyin ariza yasash formulasi ishlaydi.')}
              </p>
              <Link href="/hujjatlar" className="mt-3.5 inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-600">
                {t('Hujjatlarga o‘tish')}
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <StageView
      title={t('Sanoat palatasi — arizani tayyorlash')}
      phaseKey="SIGN"
      stages={d.stages}
      selectedId={d.selectedId}
      firms={d.firms}
      transitionsByFirm={d.transitionsByFirm}
      total={d.total}
    />
  );
}
