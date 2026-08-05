import React from 'react';
import { CertStatus } from '../core/enums';
import { STATUS_LABELS } from '../core/labels';
import { dmy } from '../core/document';

/** No-flash theme bootstrap — render inside <head> before paint. Defaults to dark. */
export function ThemeScript() {
  const code =
    "try{var t=localStorage.getItem('spravka.theme')||'dark';if(t==='dark')document.documentElement.classList.add('dark')}catch(e){document.documentElement.classList.add('dark')}";
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}

const TONE: Record<string, string> = {
  DRAFT: 'border-slate-400/25 bg-slate-400/10 text-slate-500 dark:text-slate-300',
  ADMIN_REVIEW: 'border-amber-400/30 bg-amber-400/10 text-amber-600 dark:text-amber-300',
  DIRECTOR_REVIEW: 'border-violet-400/30 bg-violet-400/10 text-violet-600 dark:text-violet-300',
  SIGNED: 'border-accent-500/30 bg-accent-500/10 text-accent-700 dark:text-accent-400',
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${TONE[status] ?? TONE.DRAFT}`}>{STATUS_LABELS[status as CertStatus] ?? status}</span>;
}

export function StatCard({
  value,
  label,
  tone = 'text-fg',
  icon: Icon,
}: {
  value: React.ReactNode;
  label: string;
  tone?: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="card p-5 transition-colors hover:border-brand-500/30">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className={`text-3xl font-bold tabular-nums ${tone}`}>{value}</div>
          <div className="mt-1 text-sm text-muted">{label}</div>
        </div>
        {Icon && <Icon className="h-5 w-5 shrink-0 text-muted" />}
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/** Shown when a certificate was sent back — carries the reviewer's reason. */
export function ReturnNotice({ note, by, at }: { note: string; by: string; at: string }) {
  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
      <p className="text-sm font-semibold text-amber-600 dark:text-amber-300">
        Qaytarildi — tuzatib qayta yuboring
      </p>
      <p className="mt-1.5 whitespace-pre-wrap text-sm text-fg">{note}</p>
      <p className="mt-2 text-xs text-muted">{by} · {at}</p>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: React.ReactNode }) {
  return (
    <div className="card p-12 text-center">
      <p className="font-medium">{title}</p>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
    </div>
  );
}

/** Table shell — rounded, bordered, hoverable rows. */
export function Table({ head, children }: { head: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-muted">{head}</thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * The contracts a maʼlumotnoma covers, for a table cell. The blanks routinely list two, so
 * each gets its own line — the same shape the old single-contract cell had.
 */
export function ContractCell({ contracts }: { contracts: { number: string; date: Date }[] }) {
  if (!contracts.length) return <span className="text-muted">—</span>;
  return (
    <>
      {contracts.map((c, i) => (
        <div key={`${c.number}-${i}`} className="truncate">
          {c.number}
          <span className="ml-1 text-[11px] opacity-70">· {dmy(c.date)}</span>
        </div>
      ))}
    </>
  );
}
