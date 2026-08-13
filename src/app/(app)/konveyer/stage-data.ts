// Server-side loader shared by the five Boshqaruv step-pages (Talabnoma, Ariza·palata,
// Invoice·sudga, Sud, MIB). Resolves the selected snapshot (default: latest), pulls the
// per-firm summary, and precomputes each firm's stage-advance transitions for THIS phase so
// the client StageView never has to import the prisma-backed konveyer lib.
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { konveyerSnapshots, konveyerSummary, PHASES, STAGE_LABEL, nextStage } from '@/lib/konveyer';

// External targets are sent out via xat.hippo / adolat — the advance row defaults its count to 1
// so a stray click can't fire the whole batch (mirrors Explorer's EXTERNAL_TARGETS).
const EXTERNAL = new Set(['TALABNOMA_SENT', 'COURT_SUBMITTED', 'MIB_SUBMITTED']);

export interface StageFirm {
  firmId: number;
  firmName: string;
  total: number;
  stir?: string | null; // for the E-IMZO key-picker to pre-select this firm's key
}
export interface StageTransition {
  from: string;
  fromLabel: string;
  count: number;
  to: string;
  toLabel: string;
  external?: boolean;
}
export interface StageData {
  snaps: { id: number; label: string; cases: number }[];
  selectedId?: number;
  total: number;
  firms: StageFirm[];
  stages: string[];
  transitionsByFirm: Record<number, StageTransition[]>;
}

/**
 * @param phaseKey one of PHASES keys — 'SIGN' | 'BOJ' | 'COURT' | 'EXEC' — or the synthetic
 *                 'TALABNOMA' parallel track (no stages, no transitions).
 * @param sParam   the raw `?s=` query value; a non-numeric one falls back to the latest snapshot
 *                 (NOT NaN, which konveyerSummary would treat as "all snapshots").
 */
export async function loadStageData(phaseKey: string, sParam?: string): Promise<StageData> {
  const snaps = await konveyerSnapshots();
  // The sidebar picker (cookie konv_s) is the SINGLE source of truth — the layout derives the picker
  // highlight AND the stepper badges from the same cookie, so page and sidebar can never disagree.
  // ?s= (sParam) is deliberately NOT honored: nothing in the app generates it, and a layout can't
  // read searchParams, so honoring a fresh ?s= deep-link would desync the sidebar. sParam is kept
  // in the signature only so existing call-sites (which still pass searchParams.s) type-check.
  const raw = cookies().get('konv_s')?.value;
  void sParam;
  const parsed = raw ? Number(raw) : NaN;
  const selectedId = Number.isInteger(parsed) && parsed > 0 && snaps.some((s) => s.id === parsed) ? parsed : snaps[0]?.id;
  const summary = await konveyerSummary(selectedId);

  const isTalabnoma = phaseKey === 'TALABNOMA';
  const stages = isTalabnoma ? [] : (PHASES.find((p) => p.key === phaseKey)?.stages ?? []);

  // Firm STIR (one tiny indexed query) so the client E-IMZO key-picker can pre-select
  // each firm's own key by matching cert TIN → STIR.
  const stirRows = await prisma.firm.findMany({ select: { id: true, stir: true } });
  const stirById = new Map(stirRows.map((f) => [f.id, f.stir]));
  const firms: StageFirm[] = summary.firms.map((f) => ({ firmId: f.firmId, firmName: f.firmName, total: f.total, stir: stirById.get(f.firmId) ?? null }));

  const transitionsByFirm: Record<number, StageTransition[]> = {};
  if (!isTalabnoma) {
    for (const f of summary.firms) {
      const ts: StageTransition[] = [];
      for (const st of stages) {
        const c = f.byStage[st] ?? 0;
        const to = nextStage(st);
        if (c > 0 && to) ts.push({ from: st, fromLabel: STAGE_LABEL[st], count: c, to, toLabel: STAGE_LABEL[to], external: EXTERNAL.has(to) });
      }
      if (ts.length) transitionsByFirm[f.firmId] = ts;
    }
  }

  return { snaps, selectedId, total: summary.total, firms, stages, transitionsByFirm };
}
