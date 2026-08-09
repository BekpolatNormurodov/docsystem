'use client';

import React, { useState } from 'react';
import { Dropdown } from './Dropdown';
import { AdvanceControls, type Transition } from './AdvanceControls';
import { CaseList } from './CaseList';
import { PalataPanel } from './PalataPanel';
import { PacketBulk } from './PacketBulk';
import { BuxgalterPanel } from './BuxgalterPanel';
import { HippoStatusPanel } from './HippoStatusPanel';

export interface PhaseMeta { key: string; label: string; color: string; stages: string[] }
export interface StageMeta { key: string; label: string }
export interface FirmRow {
  firmId: number;
  firmName: string;
  total: number;
  overdue: number;
  byStage: Record<string, number>;
  talabnomaSent: number;
}
// Person-level funnel (each person counted once, at furthest stage → conserves).
export interface FunnelFirm { firmId: number; firmName: string; total: number; phases: Record<string, number>; talabnomaSent: number }
export interface FunnelData { total: number; phases: Record<string, number>; talabnomaSent: number; firms: FunnelFirm[] }

const n = (x: number) => x.toLocaleString('ru-RU');
const EXTERNAL_TARGETS = new Set(['TALABNOMA_SENT', 'COURT_SUBMITTED', 'MIB_SUBMITTED']);

// The wow stepper: five stations on a track, the reached run filled with the
// Branch diagram: Tayyorlash splits into two parallel lanes — Talabnoma (top,
// hippo) and Ariza·palata (bottom) — which converge at Sud, then Ijro. SVG so
// the split/merge reads like a real schema. Circles are clickable to filter.
const LINE = 'var(--line, rgba(120,120,120,0.18))';
function ParallelRail({ prep, talabnoma, ariza, boj, court, exec, selected, onSelect }: {
  prep: number; talabnoma: number; ariza: number; boj: number; court: number; exec: number;
  selected: string | null; onSelect: (k: string) => void;
}) {
  // Flow: Tayyorlash splits into Talabnoma(top) + Ariza·palata(bottom); both
  // MERGE into Invoice, then Sud, then Ijro.
  const N = {
    prep: { x: 60, y: 95, r: 32, c: '#64748b', v: prep, label: 'Tayyorlash', key: 'PREP' },
    tal: { x: 250, y: 46, r: 28, c: '#0ea5e9', v: talabnoma, label: 'Talabnoma (hippo)', key: 'TALABNOMA' },
    ariza: { x: 250, y: 152, r: 28, c: '#8b5cf6', v: ariza, label: 'Ariza · palata', key: 'SIGN' },
    inv: { x: 490, y: 99, r: 32, c: '#f59e0b', v: boj, label: 'Invoice', key: 'BOJ' },
    court: { x: 700, y: 99, r: 32, c: '#3b82f6', v: court, label: 'Sud (adolat)', key: 'COURT' },
    exec: { x: 880, y: 99, r: 28, c: '#14b8a6', v: exec, label: 'Ijro (MIB)', key: 'EXEC' },
  };
  const curve = (x1: number, y1: number, x2: number, y2: number, on: boolean, color: string) =>
    <path d={`M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`} fill="none" stroke={on ? color : LINE} strokeWidth={on ? 3 : 2} />;
  const straight = (x1: number, y1: number, x2: number, y2: number, on: boolean, color: string) =>
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={on ? color : LINE} strokeWidth={on ? 3 : 2} />;

  const Node = (nd: typeof N.prep) => {
    const on = nd.v > 0, sel = selected === nd.key;
    return (
      <g
        role="button"
        tabIndex={0}
        aria-label={`${nd.label}: ${on ? n(nd.v) : 0}`}
        aria-pressed={sel}
        onClick={() => onSelect(nd.key)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(nd.key); } }}
        className="cursor-pointer outline-none focus-visible:[outline:2px_solid_var(--brand-500,#3b82f6)] focus-visible:[outline-offset:3px] rounded-full"
      >
        <circle cx={nd.x} cy={nd.y} r={nd.r} fill={on ? nd.c : 'transparent'} stroke={on ? nd.c : 'var(--muted,#94a3b8)'} strokeWidth={on ? 0 : 2} strokeDasharray={on ? undefined : '5 4'} />
        {sel && <circle cx={nd.x} cy={nd.y} r={nd.r + 5} fill="none" stroke={nd.c} strokeWidth={2} opacity={0.55} />}
        <text x={nd.x} y={nd.y + 6} textAnchor="middle" fontSize={17} fontWeight={700} fill={on ? '#fff' : 'var(--muted,#94a3b8)'} style={{ pointerEvents: 'none' }}>{on ? n(nd.v) : '·'}</text>
        <text x={nd.x} y={nd.y + nd.r + 17} textAnchor="middle" fontSize={11.5} fill="var(--muted,#64748b)" fontWeight={sel ? 700 : 400} style={{ pointerEvents: 'none' }}>{nd.label}</text>
      </g>
    );
  };
  const invOn = N.inv.v > 0;

  return (
    <svg viewBox="0 0 950 225" className="w-full" style={{ maxHeight: 250 }} role="img" aria-label="Konveyer sxemasi">
      {curve(N.prep.x + N.prep.r, N.prep.y - 8, N.tal.x - N.tal.r, N.tal.y, N.tal.v > 0, N.tal.c)}
      {curve(N.prep.x + N.prep.r, N.prep.y + 8, N.ariza.x - N.ariza.r, N.ariza.y, N.ariza.v > 0, N.ariza.c)}
      {/* both lanes merge into Invoice */}
      {curve(N.tal.x + N.tal.r, N.tal.y, N.inv.x - N.inv.r, N.inv.y - 8, invOn, N.inv.c)}
      {curve(N.ariza.x + N.ariza.r, N.ariza.y, N.inv.x - N.inv.r, N.inv.y + 8, invOn, N.inv.c)}
      {straight(N.inv.x + N.inv.r, N.inv.y, N.court.x - N.court.r, N.court.y, N.court.v > 0, N.court.c)}
      {straight(N.court.x + N.court.r, N.court.y, N.exec.x - N.exec.r, N.exec.y, N.exec.v > 0, N.exec.c)}
      {Node(N.prep)}{Node(N.tal)}{Node(N.ariza)}{Node(N.inv)}{Node(N.court)}{Node(N.exec)}
    </svg>
  );
}

export function Explorer({ phases, stages, firms, funnel, snapshotId }: {
  phases: PhaseMeta[]; stages: StageMeta[]; firms: FirmRow[]; funnel: FunnelData; snapshotId?: number;
}) {
  const [firmId, setFirmId] = useState<number | null>(null); // null => Hamma firma
  const [phaseKey, setPhaseKey] = useState<string | null>(null);

  // Person-level funnel drives the rail + per-firm cards (conserves to total).
  const firm = funnel.firms.find((f) => f.firmId === firmId) ?? null;
  const summaryFirm = firms.find((f) => f.firmId === firmId) ?? null; // per-case, for stage advance
  const scopePhases = firm ? firm.phases : funnel.phases;
  const counts = phases.map((p) => scopePhases[p.key] ?? 0);
  const scopeTalabnoma = firm ? firm.talabnomaSent : funnel.talabnomaSent;
  // Talabnoma is a parallel track (talabnomaAt), not a stage — synthetic phase.
  const TAL_PHASE: PhaseMeta = { key: 'TALABNOMA', label: 'Talabnoma (hippo)', color: '#0ea5e9', stages: [] };
  const activePhase = phaseKey === 'TALABNOMA' ? TAL_PHASE : (phases.find((p) => p.key === phaseKey) ?? null);
  const talabnomaFilter = phaseKey === 'TALABNOMA';

  const firmOpts = [{ value: 'all', label: 'Hamma firma' }, ...funnel.firms.map((f) => ({ value: String(f.firmId), label: f.firmName, hint: n(f.total) }))];

  const transitions: Transition[] = [];
  if (summaryFirm && activePhase) {
    for (let i = 0; i < stages.length - 1; i++) {
      const from = stages[i], to = stages[i + 1];
      const c = summaryFirm.byStage[from.key] ?? 0;
      if (c > 0 && activePhase.stages.includes(from.key))
        transitions.push({ from: from.key, fromLabel: from.label, count: c, to: to.key, toLabel: to.label, external: EXTERNAL_TARGETS.has(to.key) });
    }
  }

  return (
    <div className="space-y-4">
      {/* scope + hero rail */}
      <div className="card px-6 py-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Dropdown
            value={firmId ? String(firmId) : 'all'}
            options={firmOpts}
            onChange={(v) => setFirmId(v === 'all' ? null : Number(v))}
            className="min-w-[240px]"
          />
          <div className="text-xs text-muted">{activePhase ? `Bosqich: ${activePhase.label}` : 'Bosqichni bosing yoki pastdan qidiring'}</div>
        </div>

        <ParallelRail
          prep={counts[0] ?? 0}
          talabnoma={scopeTalabnoma}
          ariza={counts[1] ?? 0}
          boj={counts[2] ?? 0}
          court={counts[3] ?? 0}
          exec={counts[4] ?? 0}
          selected={phaseKey}
          onSelect={(k) => setPhaseKey((cur) => (cur === k ? null : k))}
        />
      </div>

      {phaseKey === 'BOJ' && <BuxgalterPanel snapshotId={snapshotId} firmId={firmId ?? undefined} />}
      {phaseKey === 'SIGN' && <PalataPanel />}
      {phaseKey === 'TALABNOMA' && <HippoStatusPanel firmId={firmId ?? undefined} />}

      {/* per-firm statistics for the chosen station (all-firms mode) */}
      {activePhase && !firm && !talabnomaFilter && (
        <div className="card p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: activePhase.color }} />
            <span className="text-sm font-semibold">{activePhase.label}</span>
            <span className="text-xs text-muted">— firmalar bo'yicha</span>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
            {[...funnel.firms]
              .map((f) => ({ f, c: f.phases[activePhase.key] ?? 0 }))
              .sort((a, b) => b.c - a.c)
              .map(({ f, c }) => {
                const pct = f.total > 0 ? Math.round((c / f.total) * 100) : 0;
                return (
                  <button
                    key={f.firmId}
                    onClick={() => setFirmId(f.firmId)}
                    className="group rounded-xl border border-line p-3 text-left transition-all hover:-translate-y-0.5 hover:border-brand-500/40 hover:shadow-sm"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-2xl font-bold tabular-nums" style={{ color: c > 0 ? activePhase.color : 'var(--muted)' }}>{n(c)}</span>
                      <span className="text-[10px] text-muted">/ {n(f.total)}</span>
                    </div>
                    <div className="mt-1.5 truncate text-[11px] font-medium text-muted group-hover:text-fg">{f.firmName}</div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: activePhase.color }} />
                    </div>
                  </button>
                );
              })}
          </div>
        </div>
      )}

      {/* users — global by default, filtered by the chosen station */}
      <div className="card p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">Mijozlar</span>
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-surface-2 px-2 py-1 text-xs font-medium">
            {firm ? firm.firmName : 'Hamma firma'}
            {firm && <button onClick={() => setFirmId(null)} className="text-muted hover:text-rose-500" aria-label="Firma filtrini olib tashlash">✕</button>}
          </span>
          {activePhase && (
            <span className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium" style={{ background: `${activePhase.color}18`, color: activePhase.color }}>
              {activePhase.label}
              <button onClick={() => setPhaseKey(null)} className="opacity-70 hover:opacity-100" aria-label="Bosqich filtrini olib tashlash">✕</button>
            </span>
          )}
          {(firm || activePhase) && (
            <button onClick={() => { setFirmId(null); setPhaseKey(null); }} className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs font-medium text-muted transition-colors hover:border-rose-500/40 hover:text-rose-500">
              ✕ Tozalash
            </button>
          )}
          <div className="ml-auto">
            <PacketBulk
              firmId={firmId ?? undefined}
              snapshotId={snapshotId}
              stages={talabnomaFilter ? [] : (activePhase ? activePhase.stages : [])}
              scopeLabel={`${firm ? firm.firmName : 'Hamma firma'}${activePhase ? ` · ${activePhase.label}` : ''}`}
            />
          </div>
        </div>
        <CaseList
          key={`${firmId ?? 'all'}-${phaseKey ?? 'all'}`}
          firmId={firmId ?? undefined}
          snapshotId={snapshotId}
          stages={activePhase ? activePhase.stages : []}
          talabnoma={talabnomaFilter}
          phaseLabel={activePhase?.label}
        />
      </div>

      {/* per-firm stage advance (only when a firm + phase chosen) */}
      {transitions.length > 0 && (
        <div className="card p-4">
          <div className="mb-2 text-xs font-semibold text-muted">Bosqichni o'tkazish · {activePhase?.label}</div>
          <AdvanceControls firmId={summaryFirm!.firmId} transitions={transitions} />
        </div>
      )}
    </div>
  );
}
