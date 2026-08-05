import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { PageHeader } from '@/ui';
import { formatSumDecimal } from '@/core/document';
import { ImportForm } from './ImportForm';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, { label: string; cls: string }> = {
  READY: { label: 'Tayyor', cls: 'border-accent-500/30 bg-accent-500/10 text-accent-700 dark:text-accent-400' },
  IMPORTING: { label: 'Yuklanmoqda…', cls: 'border-brand-500/30 bg-brand-500/10 text-brand-700 dark:text-brand-300' },
  FAILED: { label: 'Xatolik', cls: 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-300' },
};

const pretty = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
};
const when = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${pretty(d)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default async function ImportPage() {
  await requireAdmin();

  const snapshots = await prisma.snapshot.findMany({
    orderBy: { importedAt: 'desc' },
    select: { reportDate: true, sourceFileName: true, status: true, rowCount: true, processedRows: true, totalDebt: true, importedAt: true },
  });

  return (
    <div>
      <PageHeader title="Import" subtitle="Portfel faylini yuklang" />
      <ImportForm />

      <h2 className="mb-3 mt-8 text-sm font-semibold text-muted">Yuklangan portfellar</h2>
      {snapshots.length === 0 ? (
        <p className="text-sm text-muted">Hali hech narsa yuklanmagan.</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Sana</th>
                <th className="px-4 py-3 font-medium">Fayl</th>
                <th className="px-4 py-3 font-medium">Holat</th>
                <th className="px-4 py-3 text-right font-medium">Qatorlar</th>
                <th className="px-4 py-3 text-right font-medium">Jami qarz</th>
                <th className="px-4 py-3 font-medium">Yuklangan</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map((s) => {
                const date = s.reportDate.toISOString().slice(0, 10);
                const st = STATUS[s.status] ?? { label: s.status, cls: 'border-line text-muted' };
                const rows = s.status === 'READY' ? s.rowCount : s.processedRows;
                return (
                  <tr key={date} className="border-b border-line/60 last:border-0 hover:bg-surface-2">
                    <td className="px-4 py-2.5 font-medium">
                      {s.status === 'READY' ? (
                        <Link href={`/s/${date}`} className="hover:underline">{pretty(s.reportDate)}</Link>
                      ) : (
                        pretty(s.reportDate)
                      )}
                    </td>
                    <td className="max-w-[220px] truncate px-4 py-2.5 text-xs text-muted" title={s.sourceFileName}>
                      {s.sourceFileName}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`badge ${st.cls}`}>{st.label}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">{rows.toLocaleString('ru-RU')}</td>
                    <td className="px-4 py-2.5 text-right">
                      {s.status === 'READY' ? formatSumDecimal(String(s.totalDebt)) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted">{when(s.importedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
