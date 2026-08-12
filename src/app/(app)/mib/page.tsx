import { requireAdmin } from '@/lib/auth';
import { loadStageData } from '../konveyer/stage-data';
import { StageView } from '../konveyer/StageView';

export const dynamic = 'force-dynamic';

export default async function MibPage({ searchParams }: { searchParams: { s?: string } }) {
  await requireAdmin();
  const d = await loadStageData('EXEC', searchParams.s);
  return (
    <StageView
      title="MIB · ijro"
      phaseKey="EXEC"
      stages={d.stages}
      selectedId={d.selectedId}
      firms={d.firms}
      transitionsByFirm={d.transitionsByFirm}
      total={d.total}
    />
  );
}
