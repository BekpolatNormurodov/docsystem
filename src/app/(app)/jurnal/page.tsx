import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { PageHeader, EmptyState, Pagination } from '@/ui';
import { actionLabel, actionCat, type ActionCat } from '@/lib/audit-labels';
import { JurnalFilters } from './JurnalFilters';
import { ActionIcon } from './ActionIcon';
import { JobHistory } from '../konveyer/JobHistory';

export const dynamic = 'force-dynamic';

const PAGE = 20;

const TAB_ON = 'rounded-lg bg-brand-600 px-3.5 py-1.5 text-sm font-semibold text-white';
const TAB_OFF = 'rounded-lg px-3.5 py-1.5 text-sm font-medium text-muted transition-colors hover:text-fg';

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtFull = (d: Date) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${hhmm(d)}`;
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// Human relative time for very recent rows; falls back to the clock for older ones.
const rel = (d: Date) => {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 45) return 'hozir';
  if (s < 3600) return `${Math.floor(s / 60)} daq oldin`;
  if (s < 86400) return `${Math.floor(s / 3600)} soat oldin`;
  return hhmm(d);
};

// Category → the tint used for the action's icon badge (bg wash + icon color).
const CAT: Record<ActionCat, string> = {
  auth: 'bg-slate-500/12 text-slate-600 dark:text-slate-300',
  pipeline: 'bg-brand-500/12 text-brand-700 dark:text-brand-300',
  docs: 'bg-indigo-500/12 text-indigo-600 dark:text-indigo-300',
  data: 'bg-cyan-500/12 text-cyan-700 dark:text-cyan-300',
  people: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  connect: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
  danger: 'bg-rose-500/12 text-rose-600 dark:text-rose-300',
};

const AV = ['bg-rose-500', 'bg-amber-500', 'bg-emerald-500', 'bg-cyan-500', 'bg-brand-500', 'bg-indigo-500', 'bg-fuchsia-500'];
const avColor = (s: string) => AV[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % AV.length];
const initials = (s: string) => s.slice(0, 2).toUpperCase();

function detailText(detail: unknown): string {
  if (detail == null) return '';
  if (typeof detail === 'string') return detail;
  try {
    // Render as compact "key: value" pairs — friendlier than raw JSON.
    const o = detail as Record<string, unknown>;
    const parts = Object.entries(o)
      .filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0))
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`);
    const s = parts.join(' · ');
    return s.length > 140 ? s.slice(0, 137) + '…' : s;
  } catch {
    return '';
  }
}

export default async function JurnalPage({ searchParams }: { searchParams: { action?: string; q?: string; page?: string; from?: string; to?: string; tab?: string } }) {
  const me = await requireUser();
  const isAdmin = me.role === 'ADMIN';
  // «Partiyalar tarixi» (background export batches) is an admin-only operational view, tucked in here
  // as a second tab next to the audit log instead of a separate nav item.
  const tab = searchParams.tab === 'tarix' && isAdmin ? 'tarix' : 'amaliyotlar';

  const header = (
    <>
      <PageHeader
        title="Amaliyotlar"
        subtitle={isAdmin ? 'Kim, qachon, nima qildi — barcha harakatlar tarixi' : 'Sizning harakatlaringiz tarixi'}
      />
      {isAdmin && (
        <div className="mb-4 inline-flex rounded-xl border border-line bg-surface p-1">
          <a href="/jurnal" className={tab === 'amaliyotlar' ? TAB_ON : TAB_OFF}>Amaliyotlar</a>
          <a href="/jurnal?tab=tarix" className={tab === 'tarix' ? TAB_ON : TAB_OFF}>Partiyalar tarixi</a>
        </div>
      )}
    </>
  );

  // Tarix tab: just the partiyalar list (its own 20-per-page pager) — skip the audit query entirely.
  if (tab === 'tarix') {
    return <div>{header}<JobHistory perPage={20} /></div>;
  }

  const action = searchParams.action && searchParams.action !== 'all' ? searchParams.action : '';
  // Yurist may only ever see their own rows — the username filter is ignored & locked.
  const q = isAdmin ? (searchParams.q?.trim() ?? '') : '';
  const from = searchParams.from?.trim() || '';
  const to = searchParams.to?.trim() || '';
  const page = Math.max(1, Number(searchParams.page) || 1);

  const where: { action?: string; username?: string | { contains: string }; createdAt?: { gte?: Date; lte?: Date } } = {};
  if (action) where.action = action;
  if (!isAdmin) where.username = me.username;
  else if (q) where.username = { contains: q };
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(`${from}T00:00:00`);
    if (to) where.createdAt.lte = new Date(`${to}T23:59:59`);
  }

  const [rows, total, todayCount] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { id: 'desc' },
      take: PAGE,
      skip: (page - 1) * PAGE,
      select: { id: true, username: true, role: true, action: true, target: true, detail: true, createdAt: true },
    }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.count({ where: { ...where, createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } } }),
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE));
  const qs = (p: number) => {
    const sp = new URLSearchParams();
    if (action) sp.set('action', action);
    if (q) sp.set('q', q);
    if (from) sp.set('from', from);
    if (to) sp.set('to', to);
    if (p > 1) sp.set('page', String(p));
    return sp.toString() ? `?${sp}` : '';
  };

  // Group the (already newest-first) rows into day buckets.
  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000));
  const groups: { key: string; label: string; rows: typeof rows }[] = [];
  for (const r of rows) {
    const k = dayKey(r.createdAt);
    const label = k === today ? 'Bugun' : k === yesterday ? 'Kecha' : `${pad(r.createdAt.getDate())}.${pad(r.createdAt.getMonth() + 1)}.${r.createdAt.getFullYear()}`;
    const g = groups.find((x) => x.key === k);
    if (g) g.rows.push(r);
    else groups.push({ key: k, label, rows: [r] });
  }

  return (
    <div>
      {header}

      {/* stat strip */}
      <div className="mb-4 flex flex-wrap gap-2.5">
        <div className="rounded-xl border border-line bg-surface px-4 py-2.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted">Jami</div>
          <div className="text-xl font-bold tabular-nums">{total.toLocaleString('ru-RU')}</div>
        </div>
        <div className="rounded-xl border border-line bg-surface px-4 py-2.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted">Bugun</div>
          <div className="text-xl font-bold tabular-nums text-brand-600 dark:text-brand-300">{todayCount.toLocaleString('ru-RU')}</div>
        </div>
      </div>

      <div className="mb-4">
        <JurnalFilters action={action} q={q} from={from} to={to} showUser={isAdmin} />
      </div>

      {rows.length === 0 ? (
        <EmptyState title="Yozuv yo‘q" hint="Tanlangan filtr bo‘yicha hech qanday harakat topilmadi." />
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <div key={g.key}>
              <div className="sticky top-16 z-10 -mx-1 mb-2 flex items-center gap-2 bg-bg/80 px-1 py-1.5 backdrop-blur">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted">{g.label}</span>
                <span className="rounded-full bg-surface-2 px-1.5 text-[10px] font-medium leading-5 text-muted">{g.rows.length}</span>
                <span className="h-px flex-1 bg-line" />
              </div>
              <div className="space-y-1.5">
                {g.rows.map((r) => {
                  const tint = CAT[actionCat(r.action)];
                  const d = detailText(r.detail);
                  return (
                    <div key={r.id} className="flex items-start gap-3 rounded-xl border border-line bg-surface px-3.5 py-2.5 transition-all hover:border-brand-500/20 hover:bg-surface-2/40">
                      <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl ${tint}`}>
                        <ActionIcon action={r.action} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold">{actionLabel(r.action)}</span>
                          {r.target && <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-muted">{r.target}</span>}
                          <span className="ml-auto shrink-0 text-xs tabular-nums text-muted" title={fmtFull(r.createdAt)}>{g.key === today ? rel(r.createdAt) : hhmm(r.createdAt)}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
                          <span className="inline-flex items-center gap-1.5">
                            <span className={`grid h-4 w-4 place-items-center rounded-full text-[8px] font-bold text-white ${avColor(r.username)}`}>{initials(r.username)}</span>
                            <span className="font-medium text-fg">{r.username}</span>
                          </span>
                          {r.role && (
                            <span className={r.role === 'ADMIN' ? 'text-amber-600 dark:text-amber-400' : 'text-brand-600 dark:text-brand-300'}>
                              {r.role === 'ADMIN' ? 'admin' : 'yurist'}
                            </span>
                          )}
                          {d && <span className="truncate">· {d}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <Pagination page={page} pages={pages} total={total} perPage={PAGE} hrefFor={(p) => `/jurnal${qs(p)}`} unit="yozuv" />
    </div>
  );
}
