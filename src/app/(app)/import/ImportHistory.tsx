'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash } from 'iconsax-react';
import { formatSumDecimal } from '@/core/document';

export interface HistoryRow {
  id: number;
  date: string; // YYYY-MM-DD
  pretty: string; // DD.MM.YYYY
  fileName: string;
  status: 'READY' | 'IMPORTING' | 'FAILED' | string;
  rows: number;
  totalDebt: string;
  importedAt: string; // preformatted
  pct: number | null; // for IMPORTING rows
}

const BADGE: Record<string, string> = {
  READY: 'border-accent-500/30 bg-accent-500/10 text-accent-700 dark:text-accent-400',
  IMPORTING: 'border-brand-500/30 bg-brand-500/10 text-brand-700 dark:text-brand-300',
  FAILED: 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-300',
};

export function ImportHistory({ rows }: { rows: HistoryRow[] }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState<number | null>(null);

  // While anything is importing, refresh the server data every 2s so the % and status update live.
  const anyImporting = rows.some((r) => r.status === 'IMPORTING');
  useEffect(() => {
    if (!anyImporting) return;
    const t = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(t);
  }, [anyImporting, router]);

  async function remove(r: HistoryRow) {
    if (!window.confirm(`${r.pretty} — oʻchirilsinmi?\nUshbu sananing barcha mijoz/kreditlari va yuklangan fayllar oʻchadi.`)) return;
    setDeleting(r.id);
    try {
      await fetch(`/api/snapshots/${r.id}`, { method: 'DELETE' });
      router.refresh();
    } finally {
      setDeleting(null);
    }
  }

  if (rows.length === 0) return <p className="text-sm text-muted">Hali hech narsa yuklanmagan.</p>;

  return (
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
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const clickable = r.status === 'READY';
            return (
              <tr
                key={r.id}
                onClick={clickable ? () => router.push(`/s/${r.date}`) : undefined}
                className={`border-t border-line ${clickable ? 'cursor-pointer hover:bg-surface-2' : ''}`}
              >
                <td className="px-4 py-2.5 font-medium">{r.pretty}</td>
                <td className="max-w-[220px] truncate px-4 py-2.5 text-xs text-muted" title={r.fileName}>
                  {r.fileName}
                </td>
                <td className="px-4 py-2.5">
                  <span className={`badge ${BADGE[r.status] ?? 'border-line text-muted'}`}>
                    {r.status === 'READY' ? 'Tayyor' : r.status === 'FAILED' ? 'Xatolik' : `Yuklanmoqda… ${r.pct ?? 0}%`}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{r.rows.toLocaleString('ru-RU')}</td>
                <td className="px-4 py-2.5 text-right">{r.status === 'READY' ? formatSumDecimal(r.totalDebt) : '—'}</td>
                <td className="px-4 py-2.5 text-xs text-muted">{r.importedAt}</td>
                <td className="px-2 py-2.5 text-right">
                  <button
                    type="button"
                    title="Oʻchirish"
                    aria-label="Oʻchirish"
                    disabled={deleting === r.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(r);
                    }}
                    className="rounded-lg border border-line p-1.5 text-muted transition hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-600 disabled:opacity-40 dark:hover:text-rose-300"
                  >
                    <Trash size={16} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
