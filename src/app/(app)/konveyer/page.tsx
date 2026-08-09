import { requireAdmin } from '@/lib/auth';
import { EmptyState } from '@/ui';
import { konveyerSummary, konveyerFunnel, konveyerSnapshots, STAGES, PHASES } from '@/lib/konveyer';
import { SyncButton } from './SyncButton';
import { SnapshotSelect } from './SnapshotSelect';
import { Explorer } from './Explorer';
import { ConnectionStatus } from './ConnectionStatus';

export const dynamic = 'force-dynamic';

export default async function KonveyerPage({ searchParams }: { searchParams: { s?: string } }) {
  await requireAdmin();

  const snaps = await konveyerSnapshots();
  const selectedId = searchParams.s ? Number(searchParams.s) : snaps[0]?.id;
  const [s, funnel] = await Promise.all([konveyerSummary(selectedId), konveyerFunnel(selectedId)]);

  const stagesMeta = STAGES.map((x) => ({ key: x.key, label: x.label }));

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Hisobot</h1>
        </div>
        <div className="flex items-center gap-3">
          <ConnectionStatus />
          <SnapshotSelect options={snaps} value={selectedId ?? 0} />
          <SyncButton />
        </div>
      </div>

      {s.total === 0 ? (
        <EmptyState
          title="Hali konveyerda ariza yo'q"
          hint="«Snapshot'dan yangilash» tugmasi bilan sud ro'yxatidagi mijozlarni konveyerga oling."
        />
      ) : (
        <>
          <Explorer
            phases={PHASES.map((p) => ({ key: p.key, label: p.label, color: p.color, stages: p.stages as unknown as string[] }))}
            stages={stagesMeta}
            firms={s.firms.map((f) => ({ firmId: f.firmId, firmName: f.firmName, total: f.total, overdue: f.overdue, byStage: f.byStage as Record<string, number>, talabnomaSent: f.talabnomaSent }))}
            funnel={funnel}
            snapshotId={selectedId}
          />
        </>
      )}
    </div>
  );
}
