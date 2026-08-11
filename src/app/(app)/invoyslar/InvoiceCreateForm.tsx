'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Select, TextField } from '@/ui';

interface FirmLite { id: number; shortName: string; stir: string | null; region: string | null; district: string | null; addressLine: string | null; }
interface BatchItem { index: number; status: 'PENDING' | 'OK' | 'FAILED'; invoiceNo?: string; message?: string; }
interface Progress {
  total: number; done: number; ok: number; failed: number; current: number;
  phase: 'RUNNING' | 'PAUSING' | 'DONE'; pauseLeftMs: number; items: BatchItem[];
}

// Faol paketning batchId'si — reload/navigatsiyada progressni tiklash uchun.
const LS_KEY = 'invoice_active_batch';

export function InvoiceCreateForm({ firms }: { firms: FirmLite[] }) {
  const router = useRouter();
  const [firmId, setFirmId] = useState(firms[0] ? String(firms[0].id) : '');
  const [count, setCount] = useState('15');
  const [progress, setProgress] = useState<Progress | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const firm = firms.find((f) => String(f.id) === firmId);
  const addr = [firm?.region, firm?.district, firm?.addressLine].filter(Boolean).join(', ');

  function poll(id: string) {
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(async () => {
      const res = await fetch(`/api/invoices/batch/${id}`);
      if (res.status === 404) { // paket topilmadi — eskirgan holatni tozalaymiz
        if (timer.current) clearInterval(timer.current);
        localStorage.removeItem(LS_KEY); setBusy(false); setProgress(null); setBatchId(null);
        return;
      }
      if (!res.ok) return;
      const data: Progress = await res.json();
      setProgress(data);
      if (data.phase === 'DONE' && timer.current) { clearInterval(timer.current); setBusy(false); router.refresh(); }
    }, 1500);
  }

  // Mount'da: faol paket bo'lsa (localStorage) tiklaymiz — reload/chiqib-kirishga chidamli.
  // getRestBatch bazaga fallback qiladi, shuning uchun server qayta ishga tushsa ham tiklanadi.
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(LS_KEY) : null;
    if (saved) {
      (async () => {
        const res = await fetch(`/api/invoices/batch/${saved}`);
        if (!res.ok) { localStorage.removeItem(LS_KEY); return; }
        const data: Progress = await res.json();
        setBatchId(saved); setProgress(data);
        if (data.phase !== 'DONE') { setBusy(true); poll(saved); }
      })();
    }
    return () => { if (timer.current) clearInterval(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onStart() {
    setBusy(true); setError(null); setProgress(null); setBatchId(null);
    localStorage.removeItem(LS_KEY);
    try {
      const res = await fetch('/api/invoices/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firmId: Number(firmId), count: Number(count) }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Xatolik'); setBusy(false); return; }
      setBatchId(data.batchId);
      localStorage.setItem(LS_KEY, data.batchId);
      poll(data.batchId);
    } catch { setError('Ulanishda xatolik'); setBusy(false); }
  }

  const pct = progress ? Math.round((progress.done / progress.total) * 100) : 0;
  const done = progress?.phase === 'DONE';

  return (
    <div className="card max-w-lg space-y-4 p-6">
      <Select label="Firma" value={firmId} onChange={setFirmId}
        options={firms.map((f) => ({ value: String(f.id), label: f.shortName }))} />

      <TextField label="Soni (1–100)" value={count}
        onChange={(v) => setCount(String(Math.min(100, Math.max(1, Number(v.replace(/\D/g, '')) || 1))))} />

      <div className="rounded-xl border border-line bg-surface-2 p-3 text-xs text-muted">
        <div>STIR: {firm?.stir || '—'}</div>
        <div>Manzil: {addr || <span className="text-rose-500">toʻldirilmagan</span>}</div>
        <div className="mt-1">Summa: 2 060 000 soʻm · avto (captcha kerak emas)</div>
      </div>

      <button type="button" onClick={onStart} disabled={busy || !firmId}
        className="btn-primary w-full justify-center py-2.5 disabled:opacity-50">
        {busy ? 'Jarayonda…' : 'Boshlash'}
      </button>

      {error && <p className="text-sm text-rose-600 dark:text-rose-300">{error}</p>}

      {progress && (
        <div className="space-y-3 border-t border-line pt-3">
          <div className="flex items-center justify-between text-sm font-medium">
            <span>{progress.done} / {progress.total} · <span className="text-emerald-600">✓{progress.ok}</span> <span className="text-rose-500">✗{progress.failed}</span></span>
            <span className="text-muted">
              {done ? '✓ Tugadi' : progress.phase === 'PAUSING' ? `⏸ Pauza ${Math.ceil(progress.pauseLeftMs / 1000)}s` : `Ishlayapti #${progress.current}…`}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
          </div>

          {done && batchId && progress.ok > 0 && (
            <a href={`/api/invoices/batch/${batchId}/zip`}
              className="btn-primary flex w-full justify-center py-2.5">
              ⬇ ZIP yuklab olish ({progress.ok} ta)
            </a>
          )}

          <div className="max-h-56 space-y-1 overflow-y-auto">
            {progress.items.filter((t) => t.status !== 'PENDING').map((t) => (
              <div key={t.index} className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-1.5 text-xs">
                <span>#{t.index + 1}{t.invoiceNo ? ` · №${t.invoiceNo}` : ''}</span>
                <span className={t.status === 'FAILED' ? 'text-rose-500' : 'text-emerald-600'}>
                  {t.status === 'OK' ? '✓' : `✗ ${t.message ?? ''}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
