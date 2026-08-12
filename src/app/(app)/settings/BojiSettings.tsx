'use client';

import React, { useEffect, useState } from 'react';

// Editable davlat-boji amount (soʻm). Drives the kvitansiya «Toʻlov summasi» and the
// buxgalter panel's per-invoice total. Stored as a Setting; default is 20 600.
export function BojiSettings() {
  const [amount, setAmount] = useState<number>(20600);
  const [dflt, setDflt] = useState<number>(20600);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setErr(null);
    try {
      const res = await fetch('/settings/boji', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Server xatosi (${res.status})`);
      const d = await res.json();
      setAmount(d.amount ?? 20600);
      setDflt(d.default ?? 20600);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Yuklab boʻlmadi'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true); setMsg(null); setErr(null);
    try {
      const res = await fetch('/settings/boji', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error || 'Saqlanmadi');
      setAmount(d.amount ?? amount);
      setMsg('Saqlandi ✓');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Saqlanmadi'); }
    finally { setSaving(false); }
  };

  return (
    <div className="card p-5">
      <div className="mb-1 text-sm font-semibold">Davlat boji summasi</div>
      <div className="mb-4 text-xs text-muted">Har bir kvitansiya (davlat boji) uchun summa. Kvitansiya hujjatida va buxgalteriya panelida ishlatiladi.</div>

      {loading ? (
        <div className="h-10 w-full max-w-xs animate-pulse rounded-lg bg-surface-2" />
      ) : (
        <>
          <div className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2 max-w-xs">
            <input
              type="number" min={0} max={100_000_000} step={100} value={amount}
              onChange={(ev) => setAmount(Math.max(0, Math.floor(Number(ev.target.value) || 0)))}
              className="w-32 rounded-md border border-line bg-surface px-2 py-1 text-sm font-medium tabular-nums outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
            />
            <span className="text-xs text-muted">soʻm</span>
            <span className="ml-auto text-[11px] tabular-nums text-muted">default: {dflt.toLocaleString('ru-RU')}</span>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-4 py-1.5 text-sm font-semibold text-white outline-none transition-colors hover:bg-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:opacity-60">
              {saving ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : null}
              Saqlash
            </button>
            {msg && <span role="status" className="text-xs font-medium text-emerald-600 dark:text-emerald-400">{msg}</span>}
            {err && <span role="alert" className="text-xs font-medium text-rose-500">{err}</span>}
          </div>
        </>
      )}
    </div>
  );
}
