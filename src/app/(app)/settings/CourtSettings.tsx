'use client';

import React, { useEffect, useState } from 'react';

// Sud yo'naltirish jadvali: har sud uchun kunlik limit + vaqt chegarasi (cutoff) + ish kunlari +
// qaysi firmalar chiqadi. «Sudga yuborish»da shu limit ishlaydi; oshgani keyingi ish kuniga suriladi.
interface Firm { id: number; code: string; shortName: string }
interface Court {
  id: number; billingCourtId: string; courtType: string; nameUz: string; shortName: string;
  dailyQuota: number; cutoffMinutes: number; weekdays: number[]; active: boolean; isDefault: boolean; sortOrder: number;
  firmIds: number[];
}
type Draft = Omit<Court, 'id'> & { id: number | null };

// getDay(): Yak=0..Shan=6. UI Dush-dan boshlaymiz.
const DOW = [
  { v: 1, l: 'Du' }, { v: 2, l: 'Se' }, { v: 3, l: 'Ch' }, { v: 4, l: 'Pa' }, { v: 5, l: 'Ju' }, { v: 6, l: 'Sh' }, { v: 0, l: 'Ya' },
];
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const blank = (): Draft => ({ id: null, billingCourtId: '', courtType: 'CITIZEN', nameUz: '', shortName: '', dailyQuota: 200, cutoffMinutes: 840, weekdays: [1, 2, 3, 4, 5], active: true, isDefault: false, sortOrder: 0, firmIds: [] });

export function CourtSettings() {
  const [courts, setCourts] = useState<Draft[]>([]);
  const [firms, setFirms] = useState<Firm[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | 'new' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const apply = (data: { courts: Court[]; firms: Firm[] }) => {
    setCourts(data.courts.map((c) => ({ ...c })));
    setFirms(data.firms);
  };
  const load = async () => {
    setLoading(true); setErr(null);
    try {
      const res = await fetch('/settings/courts', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Server xatosi (${res.status})`);
      apply(await res.json());
    } catch (e) { setErr(e instanceof Error ? e.message : 'Yuklab boʻlmadi'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const patch = (idx: number, p: Partial<Draft>) => setCourts((cs) => cs.map((c, i) => (i === idx ? { ...c, ...p } : c)));
  const addNew = () => setCourts((cs) => [...cs, blank()]);

  const save = async (idx: number) => {
    const c = courts[idx];
    setBusy(c.id ?? 'new'); setErr(null); setMsg(null);
    try {
      const res = await fetch('/settings/courts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', ...c }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error || 'Saqlanmadi');
      apply(d); setMsg('Saqlandi ✓'); setTimeout(() => setMsg(null), 2500);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Saqlanmadi'); }
    finally { setBusy(null); }
  };
  const remove = async (idx: number) => {
    const c = courts[idx];
    if (c.id == null) { setCourts((cs) => cs.filter((_, i) => i !== idx)); return; }
    if (!confirm(`«${c.shortName || c.nameUz}» sudini o'chirasizmi?`)) return;
    setBusy(c.id); setErr(null);
    try {
      const res = await fetch('/settings/courts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id: c.id }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error || 'O‘chirilmadi');
      apply(d);
    } catch (e) { setErr(e instanceof Error ? e.message : 'O‘chirilmadi'); }
    finally { setBusy(null); }
  };

  const inp = 'rounded-md border border-line bg-surface px-2 py-1 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15';

  return (
    <div className="card p-5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">Sudlar — yo‘naltirish va kunlik limit</div>
        <button onClick={addNew} className="rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-brand-600 hover:border-brand-500/40 dark:text-brand-400">+ Sud qo‘shish</button>
      </div>
      <div className="mb-4 text-xs text-muted">Har sud uchun kunlik limit + vaqt chegarasi (cutoff) + ish kunlari. «Sudga yuborish»da shu limit ishlaydi — oshgani keyingi ish kuniga suriladi. Firma ruxsati: qaysi firmalar shu sudga chiqadi (Bright ikkala sudga ham). Firma ruxsati bo‘lmasa — «Default» sudga ketadi.</div>

      {err && <div role="alert" className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs font-medium text-rose-600 dark:text-rose-300">{err}</div>}
      {msg && <div role="status" className="mb-3 text-xs font-medium text-emerald-600 dark:text-emerald-400">{msg}</div>}

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-28 w-full animate-pulse rounded-xl bg-surface-2" />)}</div>
      ) : (
        <div className="space-y-3">
          {courts.length === 0 && <div className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-sm text-muted">Hali sud yo‘q — «+ Sud qo‘shish».</div>}
          {courts.map((c, idx) => (
            <div key={c.id ?? `new-${idx}`} className="rounded-xl border border-line p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-[11px] text-muted">Nomi (arizada)
                  <input className={`${inp} mt-0.5 w-full`} value={c.nameUz} onChange={(e) => patch(idx, { nameUz: e.target.value })} placeholder="Fuqarolik ishlari boʻyicha … tumanlararo sudiga" />
                </label>
                <label className="text-[11px] text-muted">Qisqa nom
                  <input className={`${inp} mt-0.5 w-full`} value={c.shortName} onChange={(e) => patch(idx, { shortName: e.target.value })} placeholder="Uchtepa tumanlararo sudi" />
                </label>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <label className="text-[11px] text-muted">Sud id (billing)
                  <input className={`${inp} mt-0.5 w-full tabular-nums`} value={c.billingCourtId} onChange={(e) => patch(idx, { billingCourtId: e.target.value })} placeholder="525" />
                </label>
                <label className="text-[11px] text-muted">Kunlik limit
                  <input type="number" min={0} className={`${inp} mt-0.5 w-full tabular-nums`} value={c.dailyQuota} onChange={(e) => patch(idx, { dailyQuota: Math.max(0, Number(e.target.value) || 0) })} />
                </label>
                <label className="text-[11px] text-muted">Vaqt chegarasi
                  <input type="time" className={`${inp} mt-0.5 w-full tabular-nums`} value={hhmm(c.cutoffMinutes)} onChange={(e) => patch(idx, { cutoffMinutes: toMin(e.target.value) })} />
                </label>
                <label className="text-[11px] text-muted">Tartib
                  <input type="number" className={`${inp} mt-0.5 w-full tabular-nums`} value={c.sortOrder} onChange={(e) => patch(idx, { sortOrder: Number(e.target.value) || 0 })} />
                </label>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1">
                  <span className="mr-1 text-[11px] text-muted">Ish kunlari:</span>
                  {DOW.map((d) => {
                    const on = c.weekdays.includes(d.v);
                    return (
                      <button key={d.v} type="button" onClick={() => patch(idx, { weekdays: on ? c.weekdays.filter((x) => x !== d.v) : [...c.weekdays, d.v] })}
                        className={`h-6 w-7 rounded text-[11px] font-medium transition-colors ${on ? 'bg-brand-500 text-white' : 'border border-line text-muted hover:border-brand-500/40'}`}>{d.l}</button>
                    );
                  })}
                </div>
                <label className="flex items-center gap-1.5 text-[11px] text-muted"><input type="checkbox" checked={c.active} onChange={(e) => patch(idx, { active: e.target.checked })} /> Active</label>
                <label className="flex items-center gap-1.5 text-[11px] text-muted"><input type="checkbox" checked={c.isDefault} onChange={(e) => patch(idx, { isDefault: e.target.checked })} /> Default (ruxsatsiz firmalar shunga)</label>
              </div>

              <div className="mt-2">
                <div className="mb-1 text-[11px] text-muted">Qaysi firmalar shu sudga chiqadi (bo‘sh = faqat Default sudda ishlatiladi):</div>
                <div className="flex flex-wrap gap-1.5">
                  {firms.map((f) => {
                    const on = c.firmIds.includes(f.id);
                    return (
                      <button key={f.id} type="button" onClick={() => patch(idx, { firmIds: on ? c.firmIds.filter((x) => x !== f.id) : [...c.firmIds, f.id] })}
                        className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${on ? 'border-brand-500 bg-brand-500/10 text-brand-700 dark:text-brand-300' : 'border-line text-muted hover:border-brand-500/40'}`}>{f.shortName}</button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <button onClick={() => save(idx)} disabled={busy !== null} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-600 disabled:opacity-60">
                  {busy === (c.id ?? 'new') ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : null} Saqlash
                </button>
                <button onClick={() => remove(idx)} disabled={busy !== null} className="rounded-lg border border-rose-500/30 px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-500/10 disabled:opacity-60 dark:text-rose-300">O‘chirish</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
