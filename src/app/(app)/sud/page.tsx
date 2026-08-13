import { requireStep } from '@/lib/auth';
import { loadStageData } from '../konveyer/stage-data';
import { CourtManager } from '../konveyer/CourtManager';
import { courtReadiness, courtStatusBoard, courtReturns } from '@/lib/court-ready';

export const dynamic = 'force-dynamic';

export default async function SudPage({ searchParams }: { searchParams: { s?: string } }) {
  await requireStep('sud');
  const d = await loadStageData('COURT', searchParams.s);

  // Server-render the initial (firm=all) court-ready payload so CourtManager paints with
  // real numbers immediately and skips its on-mount fetch (one fewer round-trip, no spinner).
  const [readiness, statusBoard, returns] = await Promise.all([
    courtReadiness(d.selectedId),
    courtStatusBoard(d.selectedId),
    courtReturns(d.selectedId),
  ]);
  const initialData = { snapshotId: d.selectedId, readiness, statusBoard, returns };

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold tracking-tight">Sud (adolat)</h1>

      {/* Firma boʻyicha tayyorlik (xulosa) + har firma «Batafsil» → mijozlar drilldown + status board.
          Avvalgi 2-mijozlar-roʻyxati (StageView) olib tashlandi — CourtManager firma-statistikasi va
          drilldown yagona manba (takror emas). */}
      <CourtManager firms={d.firms} selectedId={d.selectedId} initialData={initialData} tab="send" />
    </div>
  );
}
