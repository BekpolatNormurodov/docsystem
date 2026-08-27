import { requireStep } from '@/lib/auth';
import { loadStageData } from '../konveyer/stage-data';
import { StageView } from '../konveyer/StageView';
import { StageDocBanner } from '../konveyer/StageDocBanner';

export const dynamic = 'force-dynamic';

export default async function TalabnomaPage({ searchParams }: { searchParams: { s?: string } }) {
  await requireStep('talabnoma');
  const d = await loadStageData('TALABNOMA', searchParams.s);
  return (
    <div className="space-y-4">
      {/* Bosqich tepasida: talabnoma hujjati yuklanmagan bo'lsa ogohlantirish (ixtiyoriy). */}
      <StageDocBanner kind="talabnoma" />
      <StageView
        title="Talabnoma"
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
