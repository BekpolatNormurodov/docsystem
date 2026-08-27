'use client';

import React, { useEffect, useMemo, useState } from 'react';

// Firma-markazli sud biriktirish: firmani tanla → uning sud(lar)ini dropdown bilan qo'sh/olib tashla.
// Birinchi sud = ASOSIY (ariza/invoice shundan). Ruxsat bo'lmasa firma «Default» sudga chiqadi.
interface Firm { id: number; code: string; shortName: string }
interface Court {
  id: number; shortName: string; nameUz: string; dailyQuota: number; cutoffMinutes: number;
  active: boolean; isDefault: boolean; firmIds: number[];
}

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export function FirmCourtAssign() {
  const [courts, setCourts] = useState<Court[]>([]);
  const [firms, setFirms] = useState<Firm[]>([]);
  const [firmId, setFirmId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setErr(null);
    try {
      const res = await fetch('/settings/courts', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Server xatosi (${res.status})`);
      const d = await res.json();
      setCourts(d.courts); setFirms(d.firms);
      if (firmId == null && d.firms.length) setFirmId(d.firms[0].id);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Yuklab boʻlmadi'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const defaultCourt = courts.find((c) => c.isDefault && c.active) ?? null;
  // Tanlangan firmaning sudlari (tartib bilan) — courts[].firmIds dan.
  const firmCourts = useMemo(() => {
    if (firmId == null) return [];
    return courts.filter((c) => c.firmIds.includes(firmId));
  }, [courts, firmId]);
  const addable = courts.filter((c) => c.active && firmId != null && !c.firmIds.includes(firmId));

  const save = async (courtIds: number[]) => {
    if (firmId == null) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const res = await fetch('/settings/courts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'firmCourts', firmId, courtIds }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error || 'Saqlanmadi');
      setCourts(d.courts); setFirms(d.firms);
      setMsg('Saqlandi ✓'); setTimeout(() => setMsg(null), 2500);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Saqlanmadi'); }
    finally { setBusy(false); }
  };

  const addCourt = (courtId: number) => save([...firmCourts.map((c) => c.id), courtId]);
  const removeCourt = (courtId: number) => save(firmCourts.filter((c) => c.id !== courtId).map((c) => c.id));

  const sel = 'rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15';

  return (
    <div className="card p-5">
      <div className="mb-1 text-sm font-semibold">Firma bo‘yicha sud biriktirish</div>
      <div className="mb-4 text-xs text-muted">Firmani tanlab, u qaysi sud(lar)ga chiqishini belgilang. Birinchi sud — <b>asosiy</b> (ariza va invoice shundan ketadi). Byudjet to‘lsa keyingisiga o‘tadi. Ruxsat qo‘shilmasa firma «Default» sudga chiqadi.</div>

      {err && <div role="alert" className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs font-medium text-rose-600 dark:text-rose-300">{err}</div>}
      {msg && <div role="status" className="mb-3 text-xs font-medium text-emerald-600 dark:text-emerald-400">{msg}</div>}

      {loading ? (
        <div className="h-24 w-full animate-pulse rounded-xl bg-surface-2" />
      ) : (
        <div className="space-y-4">
          <label className="block text-[11px] text-muted">Firma
            <select className={`${sel} mt-1 block w-full max-w-md`} value={firmId ?? ''} onChange={(e) => setFirmId(Number(e.target.value))}>
              {firms.map((f) => <option key={f.id} value={f.id}>{f.shortName}</option>)}
            </select>
          </label>

          <div>
            <div className="mb-1.5 text-[11px] font-medium text-muted">Shu firmaning sudlari (tartibda):</div>
            {firmCourts.length === 0 ? (
              <div className="rounded-lg border border-dashed border-line px-3 py-3 text-xs text-muted">
                Biriktirilmagan — firma «Default» sudga chiqadi{defaultCourt ? `: ${defaultCourt.shortName} (${defaultCourt.dailyQuota}/kun, ${hhmm(defaultCourt.cutoffMinutes)})` : ''}.
              </div>
            ) : (
              <ul className="space-y-1.5">
                {firmCourts.map((c, i) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2">
                    <span className="min-w-0">
                      <span className="text-sm font-medium">{i === 0 ? '★ ' : `${i + 1}. `}{c.shortName}</span>
                      <span className="ml-2 text-[11px] tabular-nums text-muted">{c.dailyQuota}/kun · {hhmm(c.cutoffMinutes)} gacha{i === 0 ? ' · asosiy' : ''}</span>
                    </span>
                    <button onClick={() => removeCourt(c.id)} disabled={busy} className="shrink-0 rounded-md border border-rose-500/30 px-2 py-0.5 text-[11px] font-medium text-rose-600 hover:bg-rose-500/10 disabled:opacity-60 dark:text-rose-300">Olib tashlash</button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {addable.length > 0 && (
            <label className="block text-[11px] text-muted">Sud qo‘shish
              <select
                className={`${sel} mt-1 block w-full max-w-md`}
                value=""
                disabled={busy}
                onChange={(e) => { const v = Number(e.target.value); if (v) addCourt(v); }}
              >
                <option value="">— sud tanlang —</option>
                {addable.map((c) => <option key={c.id} value={c.id}>{c.shortName} ({c.dailyQuota}/kun, {hhmm(c.cutoffMinutes)})</option>)}
              </select>
            </label>
          )}
        </div>
      )}
    </div>
  );
}
