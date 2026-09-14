import { requireStep } from '@/lib/auth';
import { getT } from '@/lib/i18n/server';
import { loadStageData } from '../konveyer/stage-data';
import { StageView } from '../konveyer/StageView';

export const dynamic = 'force-dynamic';

export default async function MibPage({ searchParams }: { searchParams: { s?: string } }) {
  await requireStep('mib');
  const t = getT();
  const d = await loadStageData('EXEC', searchParams.s);
  return (
    <StageView
      title={t('MIB · ijro')}
      phaseKey="EXEC"
      stages={d.stages}
      selectedId={d.selectedId}
      firms={d.firms}
      transitionsByFirm={d.transitionsByFirm}
      total={d.total}
    />
  );
}
