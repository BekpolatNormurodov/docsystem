'use client';

import React, { useEffect, useState } from 'react';

interface Editable { key: string; label: string }

export function SlaSettings() {
  const [editable, setEditable] = useState<Editable[]>([]);
  const [config, setConfig] = useState<Record<string, number>>({});
  const [defaults, setDefaults] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setErr(null);
    try {
      const res = await fetch('/settings/sla', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Server xatosi (${res.status})`);
      const d = await res.json();
      setEditable(d.editable ?? []);
      setConfig(d.config ?? {});
      setDefaults(d.defaults ?? {});
    } catch (e) { setErr(e instanceof Error ? e.message : 'Yuklab bo‘lmadi'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true); setMsg(null); setErr(null);
    try {
      const res = await fetch('/settings/sla', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sla: config }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error || 'Saqlanmadi');
      setConfig(d.config ?? config);
      setMsg('Saqlandi ✓');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Saqlanmadi'); }
    finally { setSaving(false); }
  };

  const set = (k: string, v: number) => setConfig((c) => ({ ...c, [k]: Math.max(0, Math.min(60, v || 0)) }));

  return (
    <div className="card p-5">
      <div className="mb-1 text-sm font-semibold">Bosqich muddatlari (SLA)</div>
      <div className="mb-4 text-xs text-muted">Har bosqich uchun necha <span className="font-medium text-fg">ish kuni</span> berilishi. Muddat o‘tsa case «osilgan» (qizil) bo‘ladi. Ish kunlari (shanba/yakshanba hisobga olinmaydi).</div>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-surface-2" />)}</div>
      ) : (
        <>
          <div className="space-y-2">
            {editable.map((e) => (
              <div key={e.key} className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2">
                <span className="flex-1 text-sm">{e.label}</span>
                <input
                  type="number" min={0} max={60} value={config[e.key] ?? 0}
                  onChange={(ev) => set(e.key, Number(ev.target.value))}
                  className="w-16 rounded-md border border-line bg-surface px-2 py-1 text-sm font-medium tabular-nums outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
                />
                <span className="w-12 shrink-0 text-xs text-muted">ish kuni</span>
                <span className="w-20 shrink-0 text-right text-[11px] tabular-nums text-muted">default: {defaults[e.key] ?? 0}</span>
              </div>
            ))}
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
