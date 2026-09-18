import { requireStep } from '@/lib/auth';
import { getT } from '@/lib/i18n/server';
import { loadStageData } from '../konveyer/stage-data';
import { StageView } from '../konveyer/StageView';
import { StageDocBanner } from '../konveyer/StageDocBanner';
import { TalabnomaBoard } from '../konveyer/TalabnomaBoard';

export const dynamic = 'force-dynamic';

export default async function TalabnomaPage({ searchParams }: { searchParams: { s?: string } }) {
  const t = getT();
  await requireStep('talabnoma');
  const d = await loadStageData('TALABNOMA', searchParams.s);
  return (
    <div className="space-y-4">
      {/* Bosqich tepasida: talabnoma hujjati yuklanmagan bo'lsa ogohlantirish (ixtiyoriy). */}
      <StageDocBanner kind="talabnoma" />
      {/* «Sonlar» — barcha faol firmalar bo'yicha KPI + firma×holat jadvali (nofaol firma chiqmaydi). */}
      <TalabnomaBoard snapshotId={d.selectedId} />
      <StageView
        title={t('Talabnoma')}
        phaseKey="TALABNOMA"
        talabnoma
        stages={d.stages}
        selectedId={d.selectedId}
        firms={d.firms}
        transitionsByFirm={d.transitionsByFirm}
        total={d.total}
      />
    </div>
  );
}
