// Konveyer pipeline aggregation: stage funnel + deadline stats per firm and
// overall. The Konveyer dashboard reads these. Pure DB reads — no external calls.
import { prisma } from './db';
import type { CaseStage } from '@prisma/client';
import { dueForStage } from './konveyer-sla';

// Ordered pipeline stages with Uzbek labels and a semantic color ramp key
// (matches Tailwind color families used across the app).
// Main ariza→court track (talabnoma is a PARALLEL track via talabnomaAt, not here).
export const STAGES: { key: CaseStage; label: string; tone: string }[] = [
  { key: 'IMPORTED', label: 'Import qilindi', tone: 'slate' },
  { key: 'ARIZA_GENERATED', label: 'Ariza tayyor', tone: 'sky' },
  { key: 'PRINTED', label: 'Chop etildi', tone: 'violet' },
  { key: 'CHAMBER_SENT', label: 'Palataga yetqizildi', tone: 'amber' },
  { key: 'CHAMBER_RETURNED', label: 'Palatadan keldi (imzo)', tone: 'violet' },
  { key: 'SIGNED_SCANNED', label: 'Imzo / skan', tone: 'violet' },
  { key: 'INVOICE_CREATED', label: "To'lanmagan", tone: 'amber' },
  { key: 'INVOICE_PAID', label: "To'landi", tone: 'emerald' },
  { key: 'COURT_SUBMITTED', label: 'Adolatda (sudda)', tone: 'blue' },
  { key: 'COURT_ACCEPTED', label: 'Sud qabul qildi', tone: 'emerald' },
  { key: 'COURT_RETURNED', label: 'Sud qaytardi', tone: 'rose' },
  { key: 'MIB_SUBMITTED', label: "MIB'ga chiqdi", tone: 'teal' },
  { key: 'CLOSED', label: 'Yopildi', tone: 'slate' },
];

export const STAGE_LABEL: Record<CaseStage, string> = {
  ...Object.fromEntries(STAGES.map((s) => [s.key, s.label])),
  TALABNOMA_SENT: 'Talabnoma yuborildi', // parallel track label (legacy/fallback)
} as Record<CaseStage, string>;

// Business phases the stages roll up into — the real sequence:
// Talabnoma(hippo) -> Ariza+imzo(palata/skan) -> Sud(adolat) -> Ijro(MIB).
// Davlat boji is NOT a gate: it's a paid/unpaid status tracked inside the court
// phase (INVOICE_CREATED=to'lanmagan, INVOICE_PAID=to'langan) — the claim is
// created regardless. See COURT_FEE_STAGES for the boji breakdown.
// Main track phases (ariza→court). Talabnoma is a PARALLEL branch (see
// talabnomaSent), rendered alongside — both converge at Sud.
export const PHASES: { key: string; label: string; color: string; stages: CaseStage[] }[] = [
  { key: 'PREP', label: 'Tayyorlash', color: '#64748b', stages: ['IMPORTED'] },
  { key: 'SIGN', label: 'Ariza · palata', color: '#8b5cf6', stages: ['ARIZA_GENERATED', 'PRINTED', 'CHAMBER_SENT', 'CHAMBER_RETURNED', 'SIGNED_SCANNED'] },
  { key: 'BOJ', label: 'Invoice', color: '#f59e0b', stages: ['INVOICE_CREATED', 'INVOICE_PAID'] },
  { key: 'COURT', label: 'Sud (adolat)', color: '#3b82f6', stages: ['COURT_SUBMITTED', 'COURT_ACCEPTED', 'COURT_RETURNED'] },
  { key: 'EXEC', label: 'Ijro (MIB)', color: '#14b8a6', stages: ['MIB_SUBMITTED', 'CLOSED'] },
];

// Within the court phase, boji payment split — "sudda ko'rinadi, ariza yaratilaveradi".
export const COURT_FEE_STAGES = { unpaid: 'INVOICE_CREATED', paid: 'INVOICE_PAID' } as const;

/** Roll a per-stage count map up into the five phase totals. */
export function phaseTotals(byStage: Record<CaseStage, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of PHASES) out[p.key] = p.stages.reduce((n, s) => n + (byStage[s] ?? 0), 0);
  return out;
}

export interface SnapshotOption {
  id: number;
  label: string; // dd.mm.yyyy
  cases: number;
}

/** Snapshots that have konveyer cases, newest first, for the dashboard dropdown. */
export async function konveyerSnapshots(): Promise<SnapshotOption[]> {
  const grouped = await prisma.arizaCase.groupBy({ by: ['snapshotId'], _count: { _all: true } });
  const ids = grouped.map((g) => g.snapshotId).filter((x): x is number => x != null);
  if (ids.length === 0) return [];
  const snaps = await prisma.snapshot.findMany({ where: { id: { in: ids } }, select: { id: true, reportDate: true } });
  const byId = new Map(snaps.map((s) => [s.id, s.reportDate]));
  const fmt = (d: Date) => {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
  };
  return grouped
    .filter((g) => g.snapshotId != null)
    .map((g) => ({ id: g.snapshotId as number, label: byId.get(g.snapshotId as number) ? fmt(byId.get(g.snapshotId as number)!) : `#${g.snapshotId}`, cases: g._count._all }))
    .sort((a, b) => b.id - a.id);
}

const TERMINAL: CaseStage[] = ['CLOSED'];

export interface FirmFunnel {
  firmId: number;
  firmName: string;
  total: number;
  byStage: Record<CaseStage, number>;
  overdue: number; // dueAt in the past and not terminal ("osilgan")
  inProgress: number; // not terminal ("chala qolgani")
  talabnomaSent: number; // parallel talabnoma track
}

export interface KonveyerSummary {
  total: number;
  byStage: Record<CaseStage, number>;
  overdue: number;
  inProgress: number;
  talabnomaSent: number; // parallel talabnoma track (cases with talabnomaAt)
  firms: FirmFunnel[];
}

function emptyByStage(): Record<CaseStage, number> {
  return Object.fromEntries(STAGES.map((s) => [s.key, 0])) as Record<CaseStage, number>;
}

export type ConnState = 'ACTIVE' | 'EXPIRED' | 'NONE';
export interface FirmConn { hippo: ConnState; cabinet: ConnState }

/**
 * Per-firm external-integration status keyed by firm STIR: is there a live
 * xat.hippo / cabinet(adolat) E-IMZO session? NONE => "key yo'q / ulanmagan".
 * Each firm connects its own key separately, so the dashboard can show it.
 */
export async function konveyerFirmConnections(): Promise<Record<number, FirmConn>> {
  const [firms, sessions] = await Promise.all([
    prisma.firm.findMany({ select: { id: true, stir: true } }),
    prisma.externalSession.findMany({ select: { provider: true, account: true, status: true } }),
  ]);
  // Sessions store the account as bare digits ("311976765") but Firm.stir is
  // formatted with spaces ("311 976 765") — normalize both to digits to match.
  const digits = (s: string | null | undefined) => (s ?? '').replace(/\D+/g, '');
  const byAcct = new Map<string, { hippo?: ConnState; cabinet?: ConnState }>();
  for (const s of sessions) {
    const key = digits(s.account);
    const rec = byAcct.get(key) ?? {};
    const state: ConnState = s.status === 'ACTIVE' ? 'ACTIVE' : 'EXPIRED';
    if (s.provider === 'HIPPO') rec.hippo = state;
    else rec.cabinet = state;
    byAcct.set(key, rec);
  }
  const out: Record<number, FirmConn> = {};
  for (const f of firms) {
    const rec = byAcct.get(digits(f.stir)) || {};
    out[f.id] = { hippo: rec.hippo ?? 'NONE', cabinet: rec.cabinet ?? 'NONE' };
  }
  return out;
}

/** Aggregate ArizaCase into an overall + per-firm funnel with deadline stats.
 *  Pass `snapshotId` to scope to one import date (dashboard dropdown). */
export async function konveyerSummary(snapshotId?: number): Promise<KonveyerSummary> {
  const now = new Date();
  const scope = snapshotId ? { snapshotId } : {};

  const [firms, byFirmStage, overdueGroups, talabnomaGroups] = await Promise.all([
    prisma.firm.findMany({ select: { id: true, shortName: true } }),
    prisma.arizaCase.groupBy({ by: ['firmId', 'stage'], where: scope, _count: { _all: true } }),
    prisma.arizaCase.groupBy({
      by: ['firmId'],
      where: { ...scope, dueAt: { lt: now }, stage: { notIn: TERMINAL } },
      _count: { _all: true },
    }),
    prisma.arizaCase.groupBy({
      by: ['firmId'],
      where: { ...scope, talabnomaAt: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const firmMap = new Map<number, FirmFunnel>();
  for (const f of firms) {
    firmMap.set(f.id, {
      firmId: f.id,
      firmName: f.shortName,
      total: 0,
      byStage: emptyByStage(),
      overdue: 0,
      inProgress: 0,
      talabnomaSent: 0,
    });
  }

  const overall = emptyByStage();
  let grandTotal = 0;
  let grandInProgress = 0;

  for (const g of byFirmStage) {
    const n = g._count._all;
    // Legacy stages (TALABNOMA_SENT) aren't in emptyByStage — coalesce so
    // `undefined + n = NaN` never poisons the map.
    const stage = normStage(g.stage as CaseStage);
    overall[stage] = (overall[stage] ?? 0) + n;
    grandTotal += n;
    if (!TERMINAL.includes(stage)) grandInProgress += n;
    const ff = firmMap.get(g.firmId);
    if (ff) {
      ff.byStage[stage] = (ff.byStage[stage] ?? 0) + n;
      ff.total += n;
      if (!TERMINAL.includes(stage)) ff.inProgress += n;
    }
  }

  let grandOverdue = 0;
  for (const g of overdueGroups) {
    const ff = firmMap.get(g.firmId);
    if (ff) ff.overdue = g._count._all;
    grandOverdue += g._count._all;
  }

  let grandTalabnoma = 0;
  for (const g of talabnomaGroups) {
    const ff = firmMap.get(g.firmId);
    if (ff) ff.talabnomaSent = g._count._all;
    grandTalabnoma += g._count._all;
  }

  const firmsOut = [...firmMap.values()].filter((f) => f.total > 0).sort((a, b) => b.total - a.total);

  return {
    total: grandTotal,
    byStage: overall,
    overdue: grandOverdue,
    inProgress: grandInProgress,
    talabnomaSent: grandTalabnoma,
    firms: firmsOut,
  };
}

// ── Person-level conserving funnel ────────────────────────────────────────
// The boss dashboard needs "nechta ariza qaysi stepda": each distinct person
// (PINFL) counted ONCE, at their FURTHEST stage, so the steps partition the
// 1054 persons and always sum to the total (everyone eventually flows to MIB).
// Talabnoma is a PARALLEL branch (talabnomaAt) — reported alongside, NOT summed.
const STAGE_RANK: Record<CaseStage, number> = Object.fromEntries(STAGES.map((s, i) => [s.key, i])) as Record<CaseStage, number>;
// Legacy/parallel-track stages not in the main STAGES list rank at IMPORTED level
// (talabnoma is parallel; a case sitting there hasn't progressed the main track).
const rankOf = (stage: CaseStage): number => STAGE_RANK[stage] ?? 0;
const MAIN_STAGES = new Set<CaseStage>(STAGES.map((s) => s.key));
// Non-main-track stages (legacy TALABNOMA_SENT) normalize to IMPORTED so the
// funnel's phase bucket and the list's stage filter agree for the same person.
const normStage = (stage: CaseStage): CaseStage => (MAIN_STAGES.has(stage) ? stage : 'IMPORTED');
function phaseKeyOfStage(stage: CaseStage): string {
  const p = PHASES.find((ph) => ph.stages.includes(normStage(stage)));
  return p ? p.key : 'PREP';
}
const emptyPhases = (): Record<string, number> => Object.fromEntries(PHASES.map((p) => [p.key, 0])) as Record<string, number>;

export interface FunnelFirm { firmId: number; firmName: string; total: number; phases: Record<string, number>; talabnomaSent: number }
export interface KonveyerFunnel { total: number; phases: Record<string, number>; talabnomaSent: number; firms: FunnelFirm[] }

/** Person-level funnel: distinct persons bucketed by furthest stage, conserving
 *  to the total. A person spanning firms is placed by their furthest stage
 *  OVERALL and attributed to the firm where that furthest case sits, so the
 *  per-firm buckets partition the overall funnel exactly. */
export async function konveyerFunnel(snapshotId?: number): Promise<KonveyerFunnel> {
  const scope = snapshotId ? { snapshotId } : {};
  const [rows, firms] = await Promise.all([
    prisma.arizaCase.findMany({ where: { ...scope, pinfl: { not: null } }, select: { pinfl: true, firmId: true, stage: true, talabnomaAt: true } }),
    prisma.firm.findMany({ select: { id: true, shortName: true } }),
  ]);
  const firmName = new Map(firms.map((f) => [f.id, f.shortName]));

  // Per person, pick ONE primary case = furthest stage (tie → lower firmId).
  // The person is attributed to that case's firm, so the per-firm buckets
  // partition the overall funnel exactly (no multi-firm double counting).
  const prim = new Map<string, { rank: number; firmId: number; stage: CaseStage; tal: boolean }>();
  // talabnoma-sent = new parallel flag OR the legacy TALABNOMA_SENT stage.
  const isTal = (r: { talabnomaAt: Date | null; stage: CaseStage }) => !!r.talabnomaAt || r.stage === 'TALABNOMA_SENT';
  for (const r of rows) {
    const pf = r.pinfl as string;
    const rank = rankOf(r.stage);
    const cur = prim.get(pf);
    if (!cur) { prim.set(pf, { rank, firmId: r.firmId, stage: normStage(r.stage), tal: isTal(r) }); continue; }
    if (rank > cur.rank || (rank === cur.rank && r.firmId < cur.firmId)) { cur.rank = rank; cur.firmId = r.firmId; cur.stage = normStage(r.stage); }
    if (isTal(r)) cur.tal = true;
  }

  const phases = emptyPhases();
  let talTotal = 0;
  const firmAgg = new Map<number, { total: number; phases: Record<string, number>; tal: number }>();
  for (const p of prim.values()) {
    const pk = phaseKeyOfStage(p.stage);
    phases[pk]++;
    if (p.tal) talTotal++;
    let fa = firmAgg.get(p.firmId);
    if (!fa) { fa = { total: 0, phases: emptyPhases(), tal: 0 }; firmAgg.set(p.firmId, fa); }
    fa.total++; fa.phases[pk]++; if (p.tal) fa.tal++;
  }

  const firmsOut: FunnelFirm[] = [];
  for (const [fid, fa] of firmAgg) firmsOut.push({ firmId: fid, firmName: firmName.get(fid) ?? '', total: fa.total, phases: fa.phases, talabnomaSent: fa.tal });
  firmsOut.sort((a, b) => b.total - a.total);

  return { total: prim.size, phases, talabnomaSent: talTotal, firms: firmsOut };
}

/** The stage that follows `stage` in the pipeline, or null at the end. */
export function nextStage(stage: CaseStage): CaseStage | null {
  const i = STAGES.findIndex((s) => s.key === stage);
  return i >= 0 && i < STAGES.length - 1 ? STAGES[i + 1].key : null;
}

export interface AdvanceResult {
  moved: number;
  from: CaseStage;
  to: CaseStage;
}

/**
 * Move up to `count` of a firm's oldest cases from stage `from` to `to`
 * (default: the next stage). Resets the SLA clock (stageEnteredAt + dueAt).
 * Used by the operator to mark, e.g., "N ta palataga yetqizildi".
 */
export async function advanceStage(
  firmId: number,
  from: CaseStage,
  count: number,
  to?: CaseStage,
): Promise<AdvanceResult> {
  const target = to ?? nextStage(from);
  if (!target) throw new Error('Oxirgi bosqich — keyingi yo‘q');
  if (!Number.isFinite(count) || count <= 0) throw new Error('Son noto‘g‘ri');

  const picked = await prisma.arizaCase.findMany({
    where: { firmId, stage: from },
    orderBy: { stageEnteredAt: 'asc' },
    take: Math.floor(count),
    select: { id: true },
  });
  if (picked.length === 0) return { moved: 0, from, to: target };

  const now = new Date();
  const ids = picked.map((c) => c.id);
  // Deadline from the TARGET phase's working-day SLA (ariza=3, sud=11, editable).
  const dueAt = await dueForStage(target, now);
  // Guard the write with `stage: from` so a concurrent advance that already moved
  // some of these cases can't double-advance them (and reset their SLA twice).
  const counts = await prisma.$transaction([
    prisma.arizaCase.updateMany({
      where: { id: { in: ids }, stage: from },
      data: { stage: target, stageEnteredAt: now, dueAt },
    }),
  ]);
  const moved = counts.reduce((s, c) => s + c.count, 0);
  return { moved, from, to: target };
}

export interface CaseRow {
  id: number;
  firmName: string;
  clientName: string | null;
  kod: string | null;
  pinfl: string | null;
  stage: CaseStage;
  stageLabel: string;
  dueAt: string | null;
  daysLeft: number | null; // negative => overdue ("osilgan")
  totalDebt: string;
  receiptNumber: string | null; // davlat-boji invoice; null => "invoicesi yo'q"
}

/** Paged client-level cases for a firm, optionally filtered to a set of stages
 *  (a phase). Used by the in-flow "mijozlar statuslari" drill-down. */
export async function konveyerCases(opts: {
  firmId?: number; // omit => across all firms (scoped by snapshot)
  snapshotId?: number;
  stages?: CaseStage[];
  q?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ rows: CaseRow[]; total: number; page: number; pageSize: number; pages: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));
  const q = opts.q?.trim();
  const where = {
    ...(opts.firmId ? { firmId: opts.firmId } : {}),
    ...(opts.snapshotId ? { snapshotId: opts.snapshotId } : {}),
    ...(opts.stages && opts.stages.length ? { stage: { in: opts.stages } } : {}),
    ...(q ? { OR: [{ clientName: { contains: q } }, { kod: { contains: q } }, { pinfl: { contains: q } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.arizaCase.count({ where }),
    prisma.arizaCase.findMany({
      where,
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { id: true, clientName: true, kod: true, pinfl: true, stage: true, dueAt: true, totalDebt: true, receiptNumber: true, firm: { select: { shortName: true } } },
    }),
  ]);
  const now = Date.now();
  const day = 86400000;
  return {
    total,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    rows: rows.map((r) => ({
      id: r.id,
      firmName: r.firm?.shortName ?? '',
      clientName: r.clientName,
      kod: r.kod,
      pinfl: r.pinfl,
      stage: r.stage,
      stageLabel: STAGE_LABEL[r.stage],
      dueAt: r.dueAt ? r.dueAt.toISOString() : null,
      daysLeft: r.dueAt ? ((v) => (v < 0 ? Math.floor(v) : Math.ceil(v)))((r.dueAt.getTime() - now) / day) : null,
      totalDebt: String(r.totalDebt),
      receiptNumber: r.receiptNumber,
    })),
  };
}

export interface PersonCase {
  caseId: number;
  firmId: number;
  firmName: string;
  stage: CaseStage;
  stageLabel: string;
  receiptNumber: string | null;
  talabnomaSent: boolean; // parallel talabnoma track
  dueAt: string | null;
  daysLeft: number | null;
  totalDebt: string;
}
export interface PersonRow {
  pinfl: string;
  clientName: string | null;
  kod: string | null;
  cases: PersonCase[];
  firmCount: number;
  totalDebt: string;
  minDaysLeft: number | null; // most urgent across cases
  hasInvoice: boolean; // any case has a boji invoice
}

/** People (grouped by PINFL) moving through the pipeline — one card per person,
 *  even when they have cases in 2-3 firms. Paged, searchable, stage-filtered. */
export async function konveyerPersons(opts: {
  firmId?: number;
  snapshotId?: number;
  stages?: CaseStage[];
  talabnoma?: boolean; // parallel talabnoma track (talabnomaAt set)
  q?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ persons: PersonRow[]; total: number; page: number; pageSize: number; pages: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, opts.pageSize ?? 5));
  const q = opts.q?.trim().toLowerCase();

  // Load every case in scope, group into persons, then filter on the SAME
  // primary rule the funnel uses (furthest stage, tie → lower firmId) so the
  // list count matches the rail/firm-card numbers exactly.
  const rows = await prisma.arizaCase.findMany({
    where: { pinfl: { not: null }, ...(opts.snapshotId ? { snapshotId: opts.snapshotId } : {}) },
    select: { id: true, pinfl: true, clientName: true, kod: true, firmId: true, stage: true, dueAt: true, totalDebt: true, receiptNumber: true, talabnomaAt: true, firm: { select: { shortName: true } } },
  });

  const now = Date.now();
  const day = 86400000;
  const byPinfl = new Map<string, PersonRow>();
  for (const r of rows) {
    if (!r.pinfl) continue;
    const daysLeft = r.dueAt ? ((v) => (v < 0 ? Math.floor(v) : Math.ceil(v)))((r.dueAt.getTime() - now) / day) : null;
    const pc: PersonCase = {
      caseId: r.id, firmId: r.firmId, firmName: r.firm?.shortName ?? '', stage: r.stage,
      stageLabel: STAGE_LABEL[r.stage], receiptNumber: r.receiptNumber, talabnomaSent: !!r.talabnomaAt,
      dueAt: r.dueAt ? r.dueAt.toISOString() : null, daysLeft, totalDebt: String(r.totalDebt),
    };
    const p = byPinfl.get(r.pinfl);
    if (p) p.cases.push(pc);
    else byPinfl.set(r.pinfl, { pinfl: r.pinfl, clientName: r.clientName, kod: r.kod, cases: [pc], firmCount: 0, totalDebt: '0', minDaysLeft: null, hasInvoice: false });
  }

  // Derive per-person fields + the primary case (furthest stage, tie → lower firmId).
  interface Scored { p: PersonRow; primStage: CaseStage; primFirmId: number; hasTal: boolean }
  const scored: Scored[] = [];
  for (const p of byPinfl.values()) {
    p.firmCount = new Set(p.cases.map((c) => c.firmId)).size;
    p.totalDebt = String(p.cases.reduce((s, c) => s + Number(c.totalDebt), 0));
    const days = p.cases.map((c) => c.daysLeft).filter((d): d is number => d != null);
    p.minDaysLeft = days.length ? Math.min(...days) : null;
    p.hasInvoice = p.cases.some((c) => !!c.receiptNumber);
    let best = p.cases[0];
    for (const c of p.cases) {
      const cr = rankOf(c.stage), br = rankOf(best.stage);
      if (cr > br || (cr === br && c.firmId < best.firmId)) best = c;
    }
    // Normalize so the phase filter (which uses main stages) matches the funnel's
    // bucket; hasTal also honours the legacy TALABNOMA_SENT stage.
    scored.push({ p, primStage: normStage(best.stage), primFirmId: best.firmId, hasTal: p.cases.some((c) => c.talabnomaSent || c.stage === 'TALABNOMA_SENT') });
  }

  let filtered = scored;
  if (opts.firmId) filtered = filtered.filter((s) => s.primFirmId === opts.firmId);
  if (opts.stages && opts.stages.length) filtered = filtered.filter((s) => opts.stages!.includes(s.primStage));
  if (opts.talabnoma) filtered = filtered.filter((s) => s.hasTal);
  if (q) filtered = filtered.filter((s) => (s.p.clientName?.toLowerCase().includes(q)) || (s.p.kod?.toLowerCase().includes(q)) || s.p.pinfl.toLowerCase().includes(q));
  filtered.sort((a, b) => a.p.pinfl.localeCompare(b.p.pinfl));

  const total = filtered.length;
  const persons = filtered.slice((page - 1) * pageSize, page * pageSize).map((s) => s.p);
  return { persons, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Add `days` calendar days (simple SLA clock; working-day math can refine later). */
function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

export interface SyncResult {
  snapshotId: number;
  created: number;
  skipped: number;
  unmatchedFirms: string[];
}

/**
 * Seed ArizaCase rows (stage IMPORTED) from a snapshot's court-list clients
 * (excluded = true), one case per (pinfl x firm). Idempotent: a client already
 * having a case for that firm is skipped, so re-running only adds newcomers.
 * Firm is matched by Loan.branchCode == Firm.code.
 */
export async function syncCasesFromSnapshot(snapshotId?: number): Promise<SyncResult> {
  const snap = snapshotId
    ? await prisma.snapshot.findUniqueOrThrow({ where: { id: snapshotId } })
    : await prisma.snapshot.findFirstOrThrow({ where: { status: 'READY' }, orderBy: { reportDate: 'desc' } });

  const firms = await prisma.firm.findMany({ select: { id: true, code: true } });
  const firmByCode = new Map(firms.map((f) => [f.code, f.id]));

  // Per (pinfl, branchCode): one representative client name + summed debt.
  const groups = await prisma.loan.groupBy({
    by: ['pinfl', 'branchCode', 'clientName'],
    where: { snapshotId: snap.id, excluded: true, pinfl: { not: null } },
    _sum: { totalDebt: true },
  });

  // Collapse to one row per (pinfl, branchCode) — clientName may vary, take first.
  const perCase = new Map<string, { pinfl: string; code: string; name: string; debt: number }>();
  for (const g of groups) {
    if (!g.pinfl || !g.branchCode) continue;
    const key = `${g.pinfl}::${g.branchCode}`;
    const debt = Number(g._sum.totalDebt ?? 0);
    const ex = perCase.get(key);
    if (ex) ex.debt += debt;
    else perCase.set(key, { pinfl: g.pinfl, code: g.branchCode, name: g.clientName ?? '', debt });
  }

  const existing = await prisma.arizaCase.findMany({
    where: { snapshotId: snap.id },
    select: { pinfl: true, firmId: true },
  });
  const have = new Set(existing.map((e) => `${e.pinfl}::${e.firmId}`));

  const now = new Date();
  const due = addDays(now, 3);
  const unmatched = new Set<string>();
  const rows: {
    firmId: number; snapshotId: number; pinfl: string; clientName: string;
    kod: string; stage: 'IMPORTED'; slaDays: number; dueAt: Date; totalDebt: number;
  }[] = [];

  let skipped = 0;
  for (const c of perCase.values()) {
    const firmId = firmByCode.get(c.code);
    if (!firmId) { unmatched.add(c.code); skipped++; continue; }
    if (have.has(`${c.pinfl}::${firmId}`)) { skipped++; continue; }
    rows.push({
      firmId, snapshotId: snap.id, pinfl: c.pinfl, clientName: c.name,
      kod: c.code, stage: 'IMPORTED', slaDays: 3, dueAt: due, totalDebt: c.debt,
    });
  }

  if (rows.length) await prisma.arizaCase.createMany({ data: rows });

  return { snapshotId: snap.id, created: rows.length, skipped, unmatchedFirms: [...unmatched] };
}
