import { requireStep } from '@/lib/auth';
import { loadStageData } from '../konveyer/stage-data';
import { StageView } from '../konveyer/StageView';

export const dynamic = 'force-dynamic';

// Sanoat palatasi → «Ariza yuborish» sub-item. The StageView's Mijozlar section carries the
// «Tayyorlash» ZIP export (Hisobot-style) + the case list. Scanning is the /ariza/skaner sub-page.
export default async function ArizaPage({ searchParams }: { searchParams: { s?: string } }) {
  await requireStep('ariza');
  const d = await loadStageData('SIGN', searchParams.s);
  return (
    <StageView
      title="Sanoat palatasi — arizani tayyorlash"
      phaseKey="SIGN"
      stages={d.stages}
      selectedId={d.selectedId}
      firms={d.firms}
      transitionsByFirm={d.transitionsByFirm}
      total={d.total}
    />
  );
}
