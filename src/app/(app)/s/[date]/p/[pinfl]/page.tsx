import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { loansToAriza } from '@/core/ariza';
import { formatSumDecimal, dmy } from '@/core/document';
import { fillOferta } from '@/lib/oferta-pdf';
import { firmPrimaryCourt } from '@/lib/court-routing';
import { PageHeader, StatCard } from '@/ui';
import { ArizaPreview } from './ArizaPreview';
import { OfertaPreview } from './OfertaPreview';
import { PersonFilters } from './PersonFilters';

export const dynamic = 'force-dynamic';

export default async function PersonPage({
  params,
  searchParams,
}: {
  params: { date: string; pinfl: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  // Validate the date segment before Prisma — malformed / impossible (2026-13-45,
  // 2026-02-30 rollover) → clean 404, not a 500 or the wrong day's data.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date)) notFound();
  const reportDate = new Date(params.date);
  if (Number.isNaN(reportDate.getTime()) || reportDate.toISOString().slice(0, 10) !== params.date) notFound();
  const snapshot = await prisma.snapshot.findUnique({
    where: { reportDate },
  });
  if (!snapshot) notFound();

  const c = (typeof searchParams.c === 'string' ? searchParams.c : '').trim();
  const firmSel = Array.isArray(searchParams.firm)
    ? searchParams.firm
    : searchParams.firm
      ? [searchParams.firm]
      : [];

  const [allLoans, firms, settings, cases] = await Promise.all([
    prisma.loan.findMany({
      where: { snapshotId: snapshot.id, pinfl: params.pinfl },
      orderBy: { totalDebt: 'desc' },
    }),
    prisma.firm.findMany(),
    getSettings(),
    // Shu mijozning (pinfl) konveyer case'lari — shakllangan hujjatlarni ko'rsatish uchun.
    prisma.arizaCase.findMany({
      where: { snapshotId: snapshot.id, pinfl: params.pinfl },
      include: {
        documents: { orderBy: { uploadedAt: 'asc' } },
        invoiceRecords: { where: { pdfPath: { not: null } }, select: { id: true, invoiceNo: true } },
        court: { select: { shortName: true, nameUz: true } }, // case'ga tayinlangan sud (bo'lsa)
      },
    }),
  ]);
  if (allLoans.length === 0) notFound();

  const firmByCode = new Map(firms.map((fr) => [fr.code, fr]));
  // firmId → shakllangan hujjatlar ro'yxati (kvitansiya PDF + yuklangan case hujjatlari).
  const DOC_KIND_LABEL: Record<string, string> = {
    TALABNOMA: 'Talabnoma', ARIZA: 'Ariza', SIGNED_ARIZA: 'Imzolangan ariza',
    INVOICE: 'Kvitansiya', OFERTA: 'Oferta', GUVOHNOMA: 'Guvohnoma',
    ISHONCHNOMA: 'Ishonchnoma', SHARTNOMA: 'Shartnoma', BOSHQA: 'Boshqa hujjat',
  };
  type FormedDoc = { href: string; label: string };
  const docsByFirm = new Map<number, FormedDoc[]>();
  for (const cs of cases) {
    const list = docsByFirm.get(cs.firmId) ?? [];
    for (const inv of cs.invoiceRecords) {
      list.push({ href: `/api/invoices/${inv.id}/download`, label: `Kvitansiya ${inv.invoiceNo}` });
    }
    for (const d of cs.documents) {
      list.push({ href: `/api/case-doc/${d.id}`, label: DOC_KIND_LABEL[d.kind] ?? d.fileName });
    }
    if (list.length) docsByFirm.set(cs.firmId, list);
  }

  // The person's own firms (for the filter chips), with a per-firm contract count.
  const personFirmsMap = new Map<string, number>();
  for (const l of allLoans) {
    const k = l.branchCode ?? '';
    if (k) personFirmsMap.set(k, (personFirmsMap.get(k) ?? 0) + 1);
  }
  const personFirms = [...personFirmsMap.entries()].map(([code, count]) => ({
    code,
    name: firmByCode.get(code)?.shortName ?? code,
    count,
  }));

  const loans = allLoans.filter((l) => {
    if (c && !(l.ldId ?? '').toLowerCase().includes(c.toLowerCase())) return false;
    if (firmSel.length && !firmSel.includes(l.branchCode ?? '')) return false;
    return true;
  });
  const first = allLoans[0]!;
  const isExcluded = allLoans.some((l) => l.excluded);
  const grandTotal = loans.reduce((sum, l) => sum + Number(l.totalDebt), 0);

  // Group loans by firm, preserving each firm's first appearance order.
  const byFirm = new Map<string, typeof loans>();
  for (const loan of loans) {
    const key = loan.branchCode ?? '';
    if (!byFirm.has(key)) byFirm.set(key, []);
    byFirm.get(key)!.push(loan);
  }

  // Har firmaning sudi: case'ga tayinlangan sud (courtId) bo'lsa o'shani, aks holda firma asosiy sudi.
  const presentFirmIds = [...new Set([...byFirm.keys()].map((code) => firmByCode.get(code)?.id).filter((x): x is number => !!x))];
  const primaryCourtByFirm = new Map(
    await Promise.all(presentFirmIds.map(async (id) => [id, await firmPrimaryCourt(id).catch(() => null)] as const)),
  );
  // case'dan (send/prepare vaqtida tayinlangan) real sud — firma asosiysidan ustun.
  const caseCourtByFirm = new Map<number, { short: string; full: string }>();
  for (const cs of cases) if (cs.court) caseCourtByFirm.set(cs.firmId, { short: cs.court.shortName, full: cs.court.nameUz });
  const courtForFirm = (firmId: number): { short: string; full: string } | undefined => {
    const c = caseCourtByFirm.get(firmId);
    if (c) return c;
    const p = primaryCourtByFirm.get(firmId);
    return p ? { short: p.shortName, full: p.nameUz } : undefined;
  };
  // Ariza uchun (nameUz) — eski foydalanish saqlanadi.
  const courtNameByFirm = new Map<number, string | undefined>(presentFirmIds.map((id) => [id, courtForFirm(id)?.full]));
  // Mijozning sudlari: qaysi sud → qaysi firmalar shu sudga chiqadi (badge + nomlar uchun).
  const courtGroups = new Map<string, string[]>();
  for (const code of byFirm.keys()) {
    const firm = firmByCode.get(code);
    if (!firm) continue;
    const cc = courtForFirm(firm.id);
    if (!cc) continue;
    const arr = courtGroups.get(cc.short) ?? [];
    if (!arr.includes(firm.shortName)) arr.push(firm.shortName);
    courtGroups.set(cc.short, arr);
  }
  const clientCourts = [...courtGroups.entries()].map(([court, firmsAtCourt]) => ({ court, firms: firmsAtCourt }));

  return (
    <div>
      <PageHeader
        title={first.clientName || params.pinfl}
        subtitle={`PINFL: ${params.pinfl} · Sana: ${params.date.split('-').reverse().join('.')}`}
      />

      {isExcluded && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
          <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">⚖ Sudga xat berilgan</span>
          <span className="text-xs text-muted">— sud roʻyxatiga kiritilgan mijoz</span>
        </div>
      )}

      <PersonFilters initialC={c} firms={personFirms} initialFirms={firmSel} />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Jami qarz" value={`${formatSumDecimal(String(grandTotal))} soʻm`} />
        <StatCard label="Kreditlar" value={loans.length} />
        <StatCard label="Firmalar" value={byFirm.size} />
        <StatCard label="Sudlar" value={clientCourts.length} />
      </div>

      {/* Mijozning sudlari — qaysi sud, qaysi firma(lar) shu sudga chiqadi (1 firma → 1 sud, lekin
          har xil firma har xil sudga). */}
      {clientCourts.length > 0 && (
        <div className="card mb-4 p-4">
          <div className="mb-2 flex items-center gap-2">
            <svg className="h-4 w-4 text-brand-600 dark:text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 21h18M6 21V10M18 21V10M4 10h16L12 3 4 10Z" /></svg>
            <span className="text-sm font-semibold">Sudlar</span>
            <span className="rounded-full bg-brand-500/10 px-2 py-0.5 text-xs font-medium text-brand-600 dark:text-brand-300">{clientCourts.length} ta</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {clientCourts.map(({ court, firms: firmsAtCourt }) => (
              <div key={court} className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface-2/40 px-2.5 py-1.5">
                <span className="text-[13px] font-medium">{court}</span>
                <span className="text-[11px] text-muted">{firmsAtCourt.join(', ')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card mb-4 p-5">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted">F.I.O.</dt>
            <dd className="mt-0.5 font-medium">{first.clientName || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Telefon</dt>
            <dd className="mt-0.5 font-medium">{first.phone || '—'}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted">Manzil</dt>
            <dd className="mt-0.5 font-medium">{first.postAddressUz || first.postAddress || '—'}</dd>
          </div>
        </dl>
      </div>

      {loans.length === 0 && (
        <div className="card mb-4 p-5 text-sm text-muted">Shartnoma raqami boʻyicha kredit topilmadi.</div>
      )}

      <div className="space-y-6">
          {[...byFirm.entries()].map(([branchCode, firmLoans]) => {
            const firm = firmByCode.get(branchCode);
            const firmTotal = firmLoans.reduce((sum, l) => sum + Number(l.totalDebt), 0);
            return (
              <section key={branchCode || 'unknown'} className="card p-5">
                <header className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2">
                  <h2 className="flex flex-wrap items-center gap-x-2 font-semibold">
                    {firm?.shortName ?? branchCode ?? 'Nomaʼlum firma'}
                    <span className="text-xs font-normal text-muted">· {firmLoans.length} ta shartnoma</span>
                    {firm && courtForFirm(firm.id) && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-brand-500/25 bg-brand-500/[0.06] px-2 py-0.5 text-[11px] font-medium text-brand-700 dark:text-brand-300">
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 21h18M6 21V10M18 21V10M4 10h16L12 3 4 10Z" /></svg>
                        {courtForFirm(firm.id)!.short}
                      </span>
                    )}
                  </h2>
                  <span className="rounded-lg bg-brand-600/10 px-3 py-1 text-sm font-bold tabular-nums text-brand-700 dark:text-brand-300">
                    Jami: {formatSumDecimal(String(firmTotal))} soʻm
                  </span>
                </header>

                <ul className="mb-4 space-y-2">
                  {firmLoans.map((loan) => (
                    <li key={loan.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-2 text-sm first:border-t-0 first:pt-0">
                      <span>
                        <span className="font-medium">{loan.ldId || '—'}</span>
                        {loan.dateToCr && <span className="ml-2 text-xs text-muted">{dmy(loan.dateToCr)}</span>}
                      </span>
                      <span className="font-semibold tabular-nums">{formatSumDecimal(String(loan.totalDebt))} soʻm</span>
                    </li>
                  ))}
                </ul>

                {firm && (
                  <div>
                    {(() => {
                      const formed = docsByFirm.get(firm.id) ?? [];
                      return (
                        <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
                          <a href={`/api/ariza/${firmLoans[0]!.id}`} className="btn-primary text-xs">
                            .docx — birlashtirilgan ariza
                          </a>
                          {formed.map((d, i) => (
                            <a
                              key={i}
                              href={d.href}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:border-brand-500/40 hover:text-fg"
                            >
                              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
                              {d.label}
                            </a>
                          ))}
                        </div>
                      );
                    })()}
                    <ArizaPreview props={loansToAriza(firmLoans, firm, settings, snapshot.reportDate, courtNameByFirm.get(firm.id))} />

                    {/* Oferta — har shartnomaga alohida (chromiumsiz HTML «view»). */}
                    <div className="mt-3 space-y-1.5">
                      {firmLoans.map((loan) => (
                        <OfertaPreview
                          key={loan.id}
                          label={loan.ldId || `#${loan.id}`}
                          html={fillOferta(loan as never, firm as never, loan.clientName, loan.pinfl, 0)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </section>
            );
          })}
      </div>
    </div>
  );
}
