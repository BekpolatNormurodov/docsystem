'use client';

import React, { useState } from 'react';
import { EmptyState } from '@/ui';
import { Dropdown } from './Dropdown';
import { AdvanceControls, type Transition } from './AdvanceControls';
import { CaseList } from './CaseList';
import { PalataScanPanel } from './PalataScanPanel';
import { PacketBulk } from './PacketBulk';
import { BuxgalterPanel } from './BuxgalterPanel';
import { HippoStatusPanel } from './HippoStatusPanel';
import { MibPanel } from './MibPanel';
import { TalabnomaBulk } from './TalabnomaBulk';

const n = (x: number) => x.toLocaleString('ru-RU');

export interface StageFirm {
  firmId: number;
  firmName: string;
  total: number;
}

/**
 * One Boshqaruv step-page, scoped to a single konveyer phase. Formerly this was one clickable
 * station on Explorer's rail; here the phase is fixed by the route, so there is no rail — just the
 * phase panel, the case list filtered to the phase, and the per-firm stage-advance controls.
 *
 * Firm selection is client state (drives the panels + advance target); the snapshot date is a URL
 * param via SnapshotSelect (default = latest, chosen server-side).
 */
export function StageView({
  title,
  phaseKey,
  stages,
  talabnoma = false,
  selectedId,
  firms,
  transitionsByFirm,
  total,
}: {
  title: string;
  phaseKey: 'TALABNOMA' | 'SIGN' | 'BOJ' | 'COURT' | 'EXEC';
  stages: string[];
  talabnoma?: boolean;
  selectedId?: number;
  firms: StageFirm[];
  transitionsByFirm: Record<number, Transition[]>;
  total: number;
}) {
  const [firmId, setFirmId] = useState<number | null>(null); // null => Hamma firma
  const firm = firms.find((f) => f.firmId === firmId) ?? null;
  const firmOpts = [
    { value: 'all', label: 'Hamma firma' },
    ...firms.map((f) => ({ value: String(f.firmId), label: f.firmName, hint: n(f.total) })),
  ];
  const transitions = firmId != null ? transitionsByFirm[firmId] ?? [] : [];
  // Talabnoma is a parallel track (talabnomaAt), not a stage — its packet/list use the flag, not stages.
  const listStages = talabnoma ? [] : stages;
  const scopeLabel = `${firm ? firm.firmName : 'Hamma firma'} · ${title}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <Dropdown
          value={firmId ? String(firmId) : 'all'}
          options={firmOpts}
          onChange={(v) => setFirmId(v === 'all' ? null : Number(v))}
          className="min-w-[220px]"
        />
      </div>

      {total === 0 ? (
        <EmptyState
          title="Bu snapshotda konveyerda ariza yoʻq"
          hint="Hisobot sahifasidagi «Snapshot'dan yangilash» tugmasi bilan sud roʻyxatidagilarni konveyerga oling."
        />
      ) : (
        <>
          {phaseKey === 'TALABNOMA' && <HippoStatusPanel firmId={firmId ?? undefined} />}
          {phaseKey === 'TALABNOMA' && (
            <TalabnomaBulk firmId={firmId ?? undefined} firmName={firm?.firmName} snapshotId={selectedId} scopeLabel={scopeLabel} firms={firms} onSelectFirm={setFirmId} />
          )}
          {phaseKey === 'SIGN' && <PalataScanPanel />}
          {phaseKey === 'BOJ' && <BuxgalterPanel snapshotId={selectedId} firmId={firmId ?? undefined} />}
          {phaseKey === 'EXEC' && <MibPanel snapshotId={selectedId} firmId={firmId ?? undefined} />}

          <div className="card p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">Mijozlar</span>
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-surface-2 px-2 py-1 text-xs font-medium">
                {firm ? firm.firmName : 'Hamma firma'}
                {firm && (
                  <button onClick={() => setFirmId(null)} className="text-muted hover:text-rose-500" aria-label="Firma filtrini olib tashlash">
                    ✕
                  </button>
                )}
              </span>
              <div className="ml-auto">
                <PacketBulk firmId={firmId ?? undefined} snapshotId={selectedId} stages={listStages} scopeLabel={scopeLabel} />
              </div>
            </div>
            <CaseList
              key={`${firmId ?? 'all'}-${phaseKey}`}
              firmId={firmId ?? undefined}
              snapshotId={selectedId}
              stages={listStages}
              talabnoma={talabnoma}
              phaseLabel={title}
            />
          </div>

          {firmId != null && transitions.length > 0 && (
            <div className="card p-4">
              <div className="mb-2 text-xs font-semibold text-muted">Bosqichni oʻtkazish · {title}</div>
              <AdvanceControls firmId={firmId} transitions={transitions} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
