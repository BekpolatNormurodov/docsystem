import { cookies } from 'next/headers';
import { requireAdmin } from '@/lib/auth';
import { EmptyState } from '@/ui';
import { konveyerSummary, konveyerFunnel, konveyerSnapshots, STAGES, PHASES } from '@/lib/konveyer';
import { SyncButton } from './SyncButton';
import { Explorer } from './Explorer';

export const dynamic = 'force-dynamic';

export default async function KonveyerPage({ searchParams }: { searchParams: { s?: string } }) {
  await requireAdmin();

  const snaps = await konveyerSnapshots();
  // Snapshot = the sidebar picker's cookie (konv_s) only — the SAME source the layout uses for the
  // picker highlight, so page and sidebar never disagree. ?s= is not honored (nothing generates it,
  // and honoring a fresh deep-link would desync the sidebar, which can't read searchParams). An
  // absent/non-numeric cookie falls back to latest, NOT NaN (which Summary/Funnel treat as ALL).
  const raw = cookies().get('konv_s')?.value;
  const parsedS = raw ? Number(raw) : NaN;
  const selectedId = Number.isInteger(parsedS) && parsedS > 0 && snaps.some((s) => s.id === parsedS) ? parsedS : snaps[0]?.id;
  const [s, funnel] = await Promise.all([konveyerSummary(selectedId), konveyerFunnel(selectedId)]);

  const stagesMeta = STAGES.map((x) => ({ key: x.key, label: x.label }));

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Hisobot</h1>
        </div>
        <div className="flex items-center gap-3">
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
