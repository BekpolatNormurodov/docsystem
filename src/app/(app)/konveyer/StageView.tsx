'use client';

import React, { useState } from 'react';
import { EmptyState } from '@/ui';
import { Dropdown } from './Dropdown';
import { AdvanceControls, type Transition } from './AdvanceControls';
import { CaseList } from './CaseList';
import { ClientsExcel } from './ClientsExcel';
import { BuxgalterPanel } from './BuxgalterPanel';
import { HippoStatusPanel } from './HippoStatusPanel';
import { MibPanel } from './MibPanel';
import { TalabnomaBulk } from './TalabnomaBulk';
import { ArizaBulk } from './ArizaBulk';

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
  hideHeader = false,
}: {
  title: string;
  phaseKey: 'TALABNOMA' | 'SIGN' | 'BOJ' | 'COURT' | 'EXEC';
  stages: string[];
  talabnoma?: boolean;
  selectedId?: number;
  firms: StageFirm[];
  transitionsByFirm: Record<number, Transition[]>;
  total: number;
  hideHeader?: boolean;
}) {
  // Talabnoma opens on BRIGHT by default (the main firm) so the sums/reyestr are visible on entry;
  // other phases still open on «Hamma firma». null => Hamma firma.
  const [firmId, setFirmId] = useState<number | null>(
    () => (talabnoma ? firms.find((f) => /bright/i.test(f.firmName))?.firmId ?? null : null),
  );
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
        {hideHeader
          ? <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Batafsil — mijozlar va bosqichlar</h2>
          : <h1 className="text-2xl font-bold tracking-tight">{title}</h1>}
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
          {/* SIGN (Sanoat palatasi) — «Ariza yaratish»: the heavy full-packet ZIP (ariza + PDFs). Scan
              lives in PalataManager on the ariza page, not here. */}
          {phaseKey === 'SIGN' && <ArizaBulk firmId={firmId ?? undefined} firmName={firm?.firmName} snapshotId={selectedId} scopeLabel={scopeLabel} />}
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
                {/* Every client-list header offers a plain «Excel» — the current scope's clients as
                    data (F.I.O, PINFL, kod, qarzdorlik…). */}
                <ClientsExcel firmId={firmId ?? undefined} snapshotId={selectedId} stages={listStages} talabnoma={talabnoma} />
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
