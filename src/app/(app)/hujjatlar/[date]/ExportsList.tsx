'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DocumentDownload, Trash, Box1, ArrowDown2 } from 'iconsax-react';
import { Modal } from '@/ui';

export interface ReadyExport {
  id: number;
  createdLabel: string;
  count: number;
  sizeLabel: string;
  mode: string;
  firms: string;
  q?: string;
  minDebt?: string;
}

/** Persisted list of finished ZIP exports — collapsed by default so it never buries the client cards. */
export function ExportsList({ items }: { items: ReadyExport[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ReadyExport | null>(null);
  const [busy, setBusy] = useState(false);

  if (items.length === 0) return null;

  async function confirmDelete() {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await fetch(`/api/export/${pendingDelete.id}`, { method: 'DELETE' });
      setPendingDelete(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 overflow-hidden rounded-xl border border-line bg-surface-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-surface-2"
      >
        <Box1 size={16} className="text-brand-600" />
        <span className="text-sm font-semibold">Tayyor exportlar</span>
        <span className="rounded-full bg-brand-600/10 px-2 py-0.5 text-xs font-semibold text-brand-700 dark:text-brand-300">
          {items.length}
        </span>
        <span className="ml-auto text-xs text-muted">{open ? 'Yopish' : 'Koʻrish'}</span>
        <ArrowDown2 size={16} className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="divide-y divide-line border-t border-line">
          {items.map((e) => (
            <div key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 text-sm">
              <span className="rounded-md bg-brand-600/10 px-2 py-0.5 text-xs font-semibold text-brand-700 dark:text-brand-300">
                {e.mode}
              </span>
              <span className="font-semibold tabular-nums">{e.count.toLocaleString('ru-RU')} ariza</span>
              <span className="text-xs text-muted">· {e.sizeLabel}</span>
              <span className="hidden text-xs text-muted sm:inline" title={e.firms}>
                · {e.firms.length > 40 ? `${e.firms.slice(0, 40)}…` : e.firms}
              </span>
              <span className="ml-auto text-[11px] text-muted">{e.createdLabel}</span>
              <a
                href={`/api/export/${e.id}/download`}
                className="btn-primary shrink-0 px-3 py-1.5 text-xs"
              >
                <DocumentDownload size={14} /> Yuklab olish
              </a>
              <button
                type="button"
                onClick={() => setPendingDelete(e)}
                aria-label="Oʻchirish"
                className="btn-ghost shrink-0 px-2 py-1.5 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
              >
                <Trash size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={pendingDelete !== null}
        onClose={() => !busy && setPendingDelete(null)}
        title="Exportni oʻchirish"
        description="ZIP fayl serverdan oʻchiriladi. Keyin kerak boʻlsa qaytadan yaratasiz."
        footer={
          <>
            <button type="button" onClick={() => setPendingDelete(null)} disabled={busy} className="btn-ghost">
              Bekor
            </button>
            <button type="button" onClick={confirmDelete} disabled={busy} className="btn-danger">
              <Trash size={16} /> {busy ? 'Oʻchirilmoqda…' : 'Oʻchirish'}
            </button>
          </>
        }
      >
        {pendingDelete && (
          <p className="text-sm">
            <b>{pendingDelete.mode}</b> — {pendingDelete.count.toLocaleString('ru-RU')} ta ariza ({pendingDelete.sizeLabel}).
          </p>
        )}
      </Modal>
    </div>
  );
}
