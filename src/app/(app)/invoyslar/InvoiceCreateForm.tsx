'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Select, TextField } from '@/ui';
import { PAYMENT_TYPES, INVOICE_DEFAULTS, COURT_DEFAULTS } from '@/core/invoice-fields';

interface FirmLite { id: number; shortName: string; stir: string | null; region: string | null; district: string | null; addressLine: string | null; }
interface TabState { index: number; status: string; invoiceNo?: string; message?: string; }

const STATUS_LABEL: Record<string, string> = {
  FILLING: 'Toʻldirilmoqda…',
  WAITING_HUMAN: '⏸ Captcha kuting — «Robot emasman» + «Yaratish» bosing',
  SUBMITTED: 'Yuborildi…',
  CAPTURED: '✓ Yaratildi',
  FAILED: '✗ Xatolik',
};

export function InvoiceCreateForm({ firms }: { firms: FirmLite[] }) {
  const router = useRouter();
  const [firmId, setFirmId] = useState(firms[0] ? String(firms[0].id) : '');
  const [count, setCount] = useState(String(INVOICE_DEFAULTS.count));
  const [paymentType, setPaymentType] = useState<string>(INVOICE_DEFAULTS.paymentType);
  const [amount, setAmount] = useState(String(INVOICE_DEFAULTS.amount));
  const [tabs, setTabs] = useState<TabState[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const firm = firms.find((f) => String(f.id) === firmId);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  function poll(batchId: string) {
    timer.current = setInterval(async () => {
      const res = await fetch(`/api/invoices/batch/${batchId}`);
      if (!res.ok) return;
      const data: { tabs: TabState[] } = await res.json();
      setTabs(data.tabs);
      const done = data.tabs.every((t) => t.status === 'CAPTURED' || t.status === 'FAILED');
      if (done && timer.current) { clearInterval(timer.current); setBusy(false); router.refresh(); }
    }, 1500);
  }

  async function onStart() {
    setBusy(true); setError(null); setTabs([]);
    try {
      const res = await fetch('/api/invoices/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firmId: Number(firmId), count: Number(count), paymentType, amount: Number(amount) }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Xatolik'); setBusy(false); return; }
      poll(data.batchId);
    } catch { setError('Ulanishda xatolik'); setBusy(false); }
  }

  return (
    <div className="card max-w-lg space-y-4 p-6">
      <Select label="Firma" value={firmId} onChange={setFirmId}
        options={firms.map((f) => ({ value: String(f.id), label: f.shortName }))} />

      <div className="grid grid-cols-2 gap-4">
        <TextField label="Soni" value={count} onChange={(v) => setCount(v.replace(/\D/g, '') || '1')} />
        <TextField label="Summa (soʻm)" value={amount} onChange={(v) => setAmount(v.replace(/\D/g, ''))} />
      </div>

      <Select label="Toʻlov turi" value={paymentType} onChange={setPaymentType} options={PAYMENT_TYPES} />

      <div className="rounded-xl border border-line bg-surface-2 p-3 text-xs text-muted">
        <div className="mb-1 font-semibold text-fg">Standart (default) qiymatlar:</div>
        <div>STIR: {firm?.stir || '—'} · Manzil: {[firm?.region, firm?.district, firm?.addressLine].filter(Boolean).join(', ') || '—'}</div>
        <div>Sud: {COURT_DEFAULTS.court}</div>
      </div>

      <button type="button" onClick={onStart} disabled={busy || !firmId}
        className="btn-primary w-full justify-center py-2.5 disabled:opacity-50">
        {busy ? 'Jarayonda…' : 'Boshlash'}
      </button>

      {error && <p className="text-sm text-rose-600 dark:text-rose-300">{error}</p>}

      {tabs.length > 0 && (
        <div className="space-y-2 border-t border-line pt-3">
          {tabs.map((t) => (
            <div key={t.index} className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-sm">
              <span>Tab #{t.index + 1}{t.invoiceNo ? ` · №${t.invoiceNo}` : ''}</span>
              <span className={t.status === 'FAILED' ? 'text-rose-500' : t.status === 'CAPTURED' ? 'text-emerald-600' : 'text-muted'}>
                {STATUS_LABEL[t.status] ?? t.status}{t.message ? ` — ${t.message}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
