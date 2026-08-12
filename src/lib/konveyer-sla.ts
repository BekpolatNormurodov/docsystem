// Per-phase SLA (deadline) config, working-day aware. Each phase has a default
// number of WORKING days a case may sit there before it's "osilgan" (overdue):
// ariza·palata (SIGN) = 3, sud (COURT) = 11. Editable in Settings.
import { prisma } from './db';
import type { CaseStage } from '@prisma/client';
import { PHASES } from './konveyer';

export const SLA_DEFAULTS: Record<string, number> = { PREP: 0, SIGN: 3, BOJ: 3, COURT: 11, EXEC: 0 };
// Which phases are user-facing SLA rows in Settings (0-day phases have no timer).
export const SLA_EDITABLE = [
  { key: 'SIGN', label: 'Ariza · palata (skan kutish)' },
  { key: 'BOJ', label: 'Invoice (buxgalteriya)' },
  { key: 'COURT', label: 'Sud (adolat javobi)' },
] as const;

const slaKey = (phase: string) => `sla_${phase}`;

/** Read the SLA (working days) for every phase, falling back to defaults. */
export async function getSlaConfig(): Promise<Record<string, number>> {
  const rows = await prisma.setting.findMany({ where: { key: { in: PHASES.map((p) => slaKey(p.key)) } } });
  const byKey = new Map(rows.map((r) => [r.key, Number(r.value)]));
  const out: Record<string, number> = {};
  for (const p of PHASES) {
    // A row exists only if the admin actually set it, so a stored 0 is a deliberate
    // "disable this phase's timer" — honor it (>= 0), don't revert to the default.
    const v = byKey.get(slaKey(p.key));
    out[p.key] = (v != null && Number.isFinite(v) && v >= 0) ? v : (SLA_DEFAULTS[p.key] ?? 0);
  }
  return out;
}

/** Upsert one phase's SLA (working days). */
export async function setSla(phaseKey: string, days: number): Promise<void> {
  const clean = Math.max(0, Math.min(60, Math.floor(days)));
  await prisma.setting.upsert({ where: { key: slaKey(phaseKey) }, create: { key: slaKey(phaseKey), value: String(clean) }, update: { value: String(clean) } });
}

export function phaseOfStage(stage: CaseStage): string {
  const p = PHASES.find((ph) => ph.stages.includes(stage));
  return p ? p.key : 'PREP';
}

/** Add `days` WORKING days to `from` (skips Sat/Sun). */
export function addWorkingDays(from: Date, days: number): Date {
  const d = new Date(from);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added += 1;
  }
  return d;
}

/** Deadline for a case entering `stage` now, per its phase SLA (null = no timer). */
export async function dueForStage(stage: CaseStage, from: Date = new Date()): Promise<Date | null> {
  const cfg = await getSlaConfig();
  const sla = cfg[phaseOfStage(stage)] ?? 0;
  return sla > 0 ? addWorkingDays(from, sla) : null;
}
