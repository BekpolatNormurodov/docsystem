import { Prisma, type CaseStage } from '@prisma/client';
import { prisma } from '@/lib/db';
import { EmptyState, ClickableRow, Pagination } from '@/ui';
import { formatSumDecimal } from '@/core/document';
import { getT } from '@/lib/i18n/server';
import { konveyerPersons, PHASES, STAGE_LABEL } from '@/lib/konveyer';
import { courtBadge } from '@/lib/court-result';
import { firmActivity } from '@/lib/active-firms';

const PAGE = 50;

// Bir mijozning bitta firmadagi ahvoli: qaysi bosqich (step) + rangi.
interface FirmStatus { firmName: string; stageLabel: string; color: string }
interface DisplayRow {
  pinfl: string | null;
  clientName: string | null;
  count: number; // shartnomalar (portfel) yoki firmalar (step rejimi) soni
  debt: string;
  firms: FirmStatus[];
  court: { label: string; tone: string; bad: boolean } | null;
  excluded: boolean;
}

// Sud holati uchun "eng ilg'or"ini tanlash — konveyer.ts ichidagi COURT_STATUS_RANK bilan bir xil.
const COURT_RANK: Record<string, number> = { FINISHED: 7, DECIDED: 6, IN_PROCESS: 5, RETURNED: 4, DECLINED: 4, PENDING: 2, CREATED: 1, DRAFT: 0 };
const firmShort = (name: string) => (name || '').trim().split(/\s+/)[0] || name;
function phaseInfo(stage: CaseStage) {
  const p = PHASES.find((ph) => ph.stages.includes(stage));
  return { label: STAGE_LABEL[stage] ?? String(stage), color: p?.color ?? '#64748b' };
}

// The heavy part of /mijozlar (a groupBy(pinfl,clientName) ORDER BY SUM(debt) over
// the whole snapshot) lives here so it can STREAM via <Suspense> — the page header
// + search filter paint immediately and the operator can search while this loads.
// `step` set → the list is driven by the pipeline (konveyerPersons): only clients at
// that bosqich, unified across firms. Empty → the full portfolio list (as before) with
// a per-firm status column layered on for the shown page's clients.
export async function MijozlarTable({ snapshotId, linkDate, date, q, digitsOnly, useFullText, page, step, overdue }: {
  snapshotId: number; linkDate: string; date: string; q: string; digitsOnly: boolean; useFullText: boolean; page: number; step: string; overdue: boolean;
}) {
  const t = getT();

  let rows: DisplayRow[] = [];
  let totalClients: number;
  let totalPages: number;
  let countHeader = t('Shartnoma');

  if (step || overdue) {
    // ── Pipeline rejimi (bosqich va/yoki «osilib qolgan»): ArizaCase'dan, firmalararo birlashtirilgan ──
    countHeader = t('Firma');
    const stages = step ? PHASES.find((p) => p.key === step)!.stages : [];
    const data = await konveyerPersons({ stages, overdue, snapshotId, q: q || undefined, page, pageSize: PAGE });
    totalClients = data.total;
    totalPages = data.pages;
    rows = data.persons.map((p) => {
      // Firma bo'yicha bosqich (bitta firma = bitta ish)
      const firms: FirmStatus[] = p.cases.map((c) => {
        const pi = phaseInfo(c.stage);
        return { firmName: c.firmName, stageLabel: c.stageLabel || pi.label, color: pi.color };
      });
      // Sud holati (PINFL bo'yicha) — yomon natija (qaytgan/rad) ustun.
      const bad = p.cases.find((c) => c.courtStatus && courtBadge(c.courtStatus, c.courtStatusLabel, c.courtResult)?.bad);
      const any = bad ?? p.cases.find((c) => c.courtStatus);
      const court = any ? courtBadge(any.courtStatus, any.courtStatusLabel, any.courtResult) : null;
      return { pinfl: p.pinfl, clientName: p.clientName, count: p.firmCount, debt: p.totalDebt, firms, court, excluded: true };
    });
  } else {
    // ── Portfel rejimi (avvalgidek): butun snapshot bo'yicha, qarz kamayish tartibida ──
    type Group = { pinfl: string | null; clientName: string | null; _count: number; _sum: { totalDebt: unknown } };
    let groups: Group[];

    if (useFullText) {
      const boolExpr = q.replace(/[+\-<>~*()"@]/g, ' ').trim().split(/\s+/).filter(Boolean).map((w) => `+${w}*`).join(' ');
      const passLike = `${q}%`;
      // A single `MATCH(...) OR passportSn LIKE` WHERE defeats the fulltext index — MySQL
      // full-scans the snapshot and evaluates MATCH per row (~35s at 160k loans). Instead
      // JOIN against a MATERIALIZED union of matched loan ids so each predicate uses its own
      // index (fulltext on clientName + the passportSn index), then group only the matched
      // rows. Measured 35,770ms → 85ms for a typical name search.
      const matched = Prisma.sql`JOIN (
        SELECT id FROM Loan WHERE snapshotId = ${snapshotId} AND MATCH(clientName) AGAINST(${boolExpr} IN BOOLEAN MODE)
        UNION SELECT id FROM Loan WHERE snapshotId = ${snapshotId} AND passportSn LIKE ${passLike}
      ) m ON m.id = l.id`;
      const [qrows, cnt] = await Promise.all([
        prisma.$queryRaw<{ pinfl: string; clientName: string | null; cnt: bigint; debt: string }[]>`
          SELECT l.pinfl AS pinfl, l.clientName AS clientName, COUNT(*) AS cnt, SUM(l.totalDebt) AS debt
          FROM Loan l ${matched}
          GROUP BY l.pinfl, l.clientName ORDER BY debt DESC, l.pinfl ASC LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`,
        prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM (SELECT 1 FROM Loan l ${matched} GROUP BY l.pinfl, l.clientName) t`,
      ]);
      groups = qrows.map((r) => ({ pinfl: r.pinfl, clientName: r.clientName, _count: Number(r.cnt), _sum: { totalDebt: r.debt } }));
      totalClients = Number(cnt[0]?.n ?? 0);
    } else {
      const qFilter = q
        ? digitsOnly
          ? { OR: [{ pinfl: { startsWith: q } }, { ldId: { startsWith: q } }] }
          : { OR: [{ clientName: { contains: q } }, { passportSn: { contains: q } }] }
        : {};
      const where = { snapshotId, ...qFilter };
      const cond = !q
        ? Prisma.sql`snapshotId = ${snapshotId}`
        : digitsOnly
          ? Prisma.sql`snapshotId = ${snapshotId} AND (pinfl LIKE ${`${q}%`} OR ldId LIKE ${`${q}%`})`
          : Prisma.sql`snapshotId = ${snapshotId} AND (clientName LIKE ${`%${q}%`} OR passportSn LIKE ${`%${q}%`})`;
      const [g, cnt] = await Promise.all([
        prisma.loan.groupBy({ by: ['pinfl', 'clientName'], where, _sum: { totalDebt: true }, _count: true, orderBy: [{ _sum: { totalDebt: 'desc' } }, { pinfl: 'asc' }], skip: (page - 1) * PAGE, take: PAGE }),
        prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM (SELECT 1 FROM Loan WHERE ${cond} GROUP BY pinfl, clientName) t`,
      ]);
      groups = g.map((x) => ({ pinfl: x.pinfl, clientName: x.clientName, _count: x._count, _sum: { totalDebt: x._sum.totalDebt } }));
      totalClients = Number(cnt[0]?.n ?? 0);
    }

    totalPages = Math.max(1, Math.ceil(totalClients / PAGE));
    const pagePinfls = groups.map((g) => g.pinfl).filter((p): p is string => Boolean(p));

    // Ushbu sahifadagi mijozlar uchun: (a) sud ro'yxati bayrog'i, (b) firma bo'yicha bosqich,
    // (c) sud holati — hammasi PINFL bo'yicha bitta partiyada (arzon, indeksli), exPinfls kabi.
    // Nofaol firmaning bosqich-chipi va sud holati mijoz kartasida ko'rinmasin.
    const fa = await firmActivity();
    const [exRows, caseRows, statusRows] = await Promise.all([
      pagePinfls.length ? prisma.loan.findMany({ where: { pinfl: { in: pagePinfls }, excluded: true, snapshotId }, select: { pinfl: true }, distinct: ['pinfl'] }) : Promise.resolve([]),
      pagePinfls.length ? prisma.arizaCase.findMany({ where: { snapshotId, pinfl: { in: pagePinfls }, ...fa.caseWhere }, orderBy: { firmId: 'asc' }, select: { pinfl: true, stage: true, firm: { select: { shortName: true } } } }) : Promise.resolve([]),
      pagePinfls.length ? prisma.clientCaseStatus.findMany({ where: { source: 'CABINET', pinfl: { in: pagePinfls }, snapshotId, ...(fa.hasInactive ? { branchCode: { notIn: fa.inactiveCodes } } : {}) }, select: { pinfl: true, status: true, statusLabel: true, caseResult: true, updatedAt: true } }) : Promise.resolve([]),
    ]);

    const exPinfls = new Set(exRows.map((r) => r.pinfl));
    const firmsByPinfl = new Map<string, FirmStatus[]>();
    for (const c of caseRows) {
      if (!c.pinfl) continue;
      const pi = phaseInfo(c.stage);
      const arr = firmsByPinfl.get(c.pinfl) ?? [];
      arr.push({ firmName: c.firm?.shortName ?? '', stageLabel: pi.label, color: pi.color });
      firmsByPinfl.set(c.pinfl, arr);
    }
    // Eng ilg'or (yoki yomon natijali) sud holatini PINFL bo'yicha tanlash.
    const courtRaw = new Map<string, (typeof statusRows)[number]>();
    for (const s of statusRows) {
      if (!s.pinfl) continue;
      const cur = courtRaw.get(s.pinfl);
      const badNow = !!s.caseResult && !!courtBadge(s.status, s.statusLabel, s.caseResult)?.bad;
      const badCur = cur ? !!cur.caseResult && !!courtBadge(cur.status, cur.statusLabel, cur.caseResult)?.bad : false;
      if (!cur) { courtRaw.set(s.pinfl, s); continue; }
      if (badNow && !badCur) { courtRaw.set(s.pinfl, s); continue; }
      if (badNow === badCur) {
        const rank = COURT_RANK[s.status] ?? 0;
        const curRank = COURT_RANK[cur.status] ?? 0;
        if (rank > curRank || (rank === curRank && s.updatedAt > cur.updatedAt)) courtRaw.set(s.pinfl, s);
      }
    }

    rows = groups.map((g) => {
      const pf = g.pinfl ?? '';
      const cs = pf ? courtRaw.get(pf) : undefined;
      return {
        pinfl: g.pinfl,
        clientName: g.clientName,
        count: g._count,
        debt: String(g._sum.totalDebt ?? 0),
        firms: (pf && firmsByPinfl.get(pf)) || [],
        court: cs ? courtBadge(cs.status, cs.statusLabel, cs.caseResult) : null,
        excluded: pf ? exPinfls.has(pf) : false,
      };
    });
  }

  const hrefPage = (n: number | string) => {
    const p = new URLSearchParams();
    p.set('date', date);
    if (q) p.set('q', q);
    if (step) p.set('step', step);
    p.set('page', String(n));
    return `/mijozlar?${p.toString()}`;
  };

  if (rows.length === 0) {
    return <EmptyState title={t('Mijoz topilmadi')} hint={overdue ? t('Osilib qolgan (muddati oʻtган) mijoz yoʻq.') : step ? t('Bu bosqichda mijoz yoʻq — boshqa bosqichni tanlang.') : t('Qidiruvni oʻzgartirib koʻring.')} />;
  }

  return (
    <>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">{t('PINFL')}</th>
              <th className="px-4 py-3 font-medium">{t('F.I.Sh')}</th>
              <th className="px-4 py-3 font-medium">{t('Holat (firma · bosqich)')}</th>
              <th className="px-4 py-3 text-right font-medium">{countHeader}</th>
              <th className="px-4 py-3 text-right font-medium">{t('Umumiy qarz')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <ClickableRow key={r.pinfl ?? Math.random()} href={`/s/${linkDate}/p/${r.pinfl}`}>
                <td className="px-4 py-2.5 font-mono text-xs text-muted">{r.pinfl}</td>
                <td className="px-4 py-2.5">
                  <span className="font-medium">{r.clientName}</span>
                  {r.excluded && !step && !overdue && (
                    <span className="badge ml-2 border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-300">{t('sud roʻyxatida')}</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  {r.firms.length === 0 && !r.court ? (
                    <span className="text-xs text-muted/50">—</span>
                  ) : (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {r.firms.map((f, i) => (
                        <span key={i} className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px]" title={`${f.firmName} · ${f.stageLabel}`}>
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: f.color }} aria-hidden />
                          <span className="font-semibold">{firmShort(f.firmName)}</span>
                          <span className="text-muted">· {f.stageLabel}</span>
                        </span>
                      ))}
                      {r.court && <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${r.court.tone}`}>{r.court.label}</span>}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{r.count}</td>
                <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{formatSumDecimal(r.debt)} {t('soʻm')}</td>
              </ClickableRow>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pages={totalPages} total={totalClients} perPage={PAGE} hrefTemplate={hrefPage('__P__')} unit={t('mijoz')} />
    </>
  );
}
