'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';

// Sudlar boshqaruvi — bitta joyda: har sud uchun kunlik limit + vaqt chegarasi (cutoff) + ish kunlari
// + billing «Sud id» + qaysi firmalar chiqadi. Jonli: bugun nechta yuborilgan, oyna ochiqmi.
// «Sudga yuborish»da shu limit ishlaydi (oshgani keyingi ish kuniga suriladi); invoice esa sudning
// billing «Sud id»sidan quriladi.

interface Firm { id: number; code: string; shortName: string }
interface Court {
  id: number; billingCourtId: string; courtType: string; nameUz: string; shortName: string;
  dailyQuota: number; cutoffMinutes: number; weekdays: number[]; active: boolean; isDefault: boolean; sortOrder: number;
  firmIds: number[];
  billingReady: boolean; usedToday: number; windowReason: 'ok' | 'weekend' | 'past-cutoff' | 'inactive'; caseCount: number;
}
type Draft = Omit<Court, 'id' | 'billingReady' | 'usedToday' | 'windowReason' | 'caseCount'> & { id: number | null };

// getDay(): Yak=0..Shan=6. UI Dush-dan boshlaymiz.
const DOW = [{ v: 1, l: 'Du' }, { v: 2, l: 'Se' }, { v: 3, l: 'Ch' }, { v: 4, l: 'Pa' }, { v: 5, l: 'Ju' }, { v: 6, l: 'Sh' }, { v: 0, l: 'Ya' }];
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const n = (x: number) => x.toLocaleString('ru-RU');
const blankDraft = (): Draft => ({ id: null, billingCourtId: '', courtType: 'CITIZEN', nameUz: '', shortName: '', dailyQuota: 200, cutoffMinutes: 840, weekdays: [1, 2, 3, 4, 5], active: true, isDefault: false, sortOrder: 0, firmIds: [] });
const toDraft = (c: Court): Draft => ({ id: c.id, billingCourtId: c.billingCourtId, courtType: c.courtType, nameUz: c.nameUz, shortName: c.shortName, dailyQuota: c.dailyQuota, cutoffMinutes: c.cutoffMinutes, weekdays: c.weekdays, active: c.active, isDefault: c.isDefault, sortOrder: c.sortOrder, firmIds: c.firmIds });

const WINDOW = {
  ok: { label: 'Ochiq', cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300', dot: 'bg-emerald-500' },
  weekend: { label: 'Dam olish', cls: 'border-line bg-surface-2 text-muted', dot: 'bg-slate-400' },
  'past-cutoff': { label: 'Vaqt tugadi', cls: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300', dot: 'bg-amber-500' },
  inactive: { label: 'Oʻchiq', cls: 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-300', dot: 'bg-rose-500' },
} as const;

const inp = 'rounded-lg border border-[var(--field-line)] bg-[var(--field)] px-2.5 py-1.5 text-sm text-fg outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15';

export function CourtsAdmin() {
  const [courts, setCourts] = useState<Court[] | null>(null);
  const [firms, setFirms] = useState<Firm[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // Qaysi sud tahrirlanmoqda (id yoki 'new'), va uning drafti.
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = (data: { courts: Court[]; firms: Firm[] }) => { setCourts(data.courts); setFirms(data.firms); };
  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await fetch('/settings/courts', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Server xatosi (${res.status})`);
      apply(await res.json());
    } catch (e) { setCourts([]); setErr(e instanceof Error ? e.message : 'Yuklab boʻlmadi'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 2500); };
  const startEdit = (c: Court) => { setEditing(c.id); setDraft(toDraft(c)); setErr(null); };
  const startNew = () => { setEditing('new'); setDraft(blankDraft()); setErr(null); };
  const cancel = () => { setEditing(null); setDraft(null); setErr(null); };
  const patch = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));

  const save = async () => {
    if (!draft) return;
    if (!draft.nameUz.trim() || !draft.shortName.trim() || !draft.billingCourtId.trim()) { setErr('Nomi, qisqa nom va «Sud id» majburiy'); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/settings/courts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', ...draft }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error || 'Saqlanmadi');
      apply(d); cancel(); flash('Saqlandi ✓');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Saqlanmadi'); }
    finally { setBusy(false); }
  };
  const remove = async (c: Court) => {
    if (!confirm(`«${c.shortName || c.nameUz}» sudini oʻchirasizmi?`)) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/settings/courts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id: c.id }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error || 'Oʻchirilmadi');
      apply(d); flash('Oʻchirildi');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Oʻchirilmadi'); }
    finally { setBusy(false); }
  };

  const firmName = useMemo(() => new Map(firms.map((f) => [f.id, f.shortName])), [firms]);
  const totalToday = courts?.reduce((s, c) => s + c.usedToday, 0) ?? 0;
  const totalQuota = courts?.reduce((s, c) => s + (c.active ? c.dailyQuota : 0), 0) ?? 0;

  return (
    <div className="space-y-4">
      {/* ── Header + summary ── */}
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-base font-semibold">Sudlar — yoʻnaltirish va kunlik limit</div>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
              Har sud uchun kunlik limit + vaqt chegarasi (cutoff) + ish kunlari + billing «Sud id». Firma bir nechta sudga
              chiqishi mumkin (birinchisi — asosiy). Limit «Sudga yuborish»da ishlaydi — oshgani keyingi ish kuniga suriladi.
              Ruxsat berilmagan firma «Default» sudga ketadi.
            </p>
          </div>
          <button onClick={startNew} className="btn-primary shrink-0 px-3 py-2 text-sm">+ Sud qoʻshish</button>
        </div>
        {courts && courts.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-2/40 px-2.5 py-1 text-xs">
              <span className="font-semibold tabular-nums">{courts.length}</span> <span className="text-muted">sud</span>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-2/40 px-2.5 py-1 text-xs">
              <span className="text-muted">Bugun yuborilgan:</span> <span className="font-semibold tabular-nums text-brand-600 dark:text-brand-400">{n(totalToday)}</span>
              <span className="text-muted">/ {n(totalQuota)}</span>
            </span>
          </div>
        )}
        {err && <div role="alert" className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs font-medium text-rose-600 dark:text-rose-300">{err}</div>}
        {msg && <div role="status" className="mt-3 text-xs font-medium text-emerald-600 dark:text-emerald-400">{msg}</div>}
      </div>

      {/* ── New-court editor ── */}
      {editing === 'new' && draft && (
        <CourtEditor draft={draft} firms={firms} busy={busy} onPatch={patch} onSave={save} onCancel={cancel} isNew />
      )}

      {/* ── Court cards ── */}
      {courts === null ? (
        <div className="grid gap-3 lg:grid-cols-2">{Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-40 animate-pulse rounded-2xl bg-surface-2" />)}</div>
      ) : courts.length === 0 ? (
        <div className="card grid place-items-center p-10 text-sm text-muted">Hali sud yoʻq — «+ Sud qoʻshish».</div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {courts.map((c) =>
            editing === c.id && draft ? (
              <CourtEditor key={c.id} draft={draft} firms={firms} busy={busy} onPatch={patch} onSave={save} onCancel={cancel} />
            ) : (
              <CourtCard key={c.id} c={c} firmName={firmName} onEdit={() => startEdit(c)} onDelete={() => remove(c)} busy={busy} />
            ),
          )}
        </div>
      )}
      {/* «Firma → sud biriktirish» olib tashlandi — firma biriktirish endi sud tahrirlash
          ичидаги «Qaysi firmalar shu sudga chiqadi» qismида qilinadi (takror emas). */}
    </div>
  );
}

// ── Read view: live quota meter + window + billing warning + firm chips ──────
function CourtCard({ c, firmName, onEdit, onDelete, busy }: { c: Court; firmName: Map<number, string>; onEdit: () => void; onDelete: () => void; busy: boolean }) {
  const win = WINDOW[c.windowReason];
  const pct = c.dailyQuota > 0 ? Math.min(100, Math.round((c.usedToday / c.dailyQuota) * 100)) : 0;
  const remaining = Math.max(0, c.dailyQuota - c.usedToday);
  const meterCls = c.windowReason !== 'ok' ? 'bg-slate-300 dark:bg-slate-600' : pct >= 100 ? 'bg-rose-500' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500';

  return (
    <div className="card flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-semibold">{c.shortName || c.nameUz}</span>
            {c.isDefault && <span className="rounded-full border border-brand-500/30 bg-brand-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-300">Default</span>}
            <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${win.cls}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${win.dot}`} /> {win.label}
            </span>
          </div>
          <div className="mt-0.5 truncate text-[11px] text-muted">{c.nameUz}</div>
        </div>
        <div className="flex shrink-0 gap-1">
          <button onClick={onEdit} disabled={busy} aria-label="Tahrirlash" className="grid h-7 w-7 place-items-center rounded-lg border border-line text-muted transition-colors hover:border-brand-500/40 hover:text-fg disabled:opacity-50">
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
          </button>
          <button onClick={onDelete} disabled={busy} aria-label="Oʻchirish" className="grid h-7 w-7 place-items-center rounded-lg border border-line text-muted transition-colors hover:border-rose-500/40 hover:text-rose-500 disabled:opacity-50">
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
          </button>
        </div>
      </div>

      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1">
          Sud id:
          {c.billingReady
            ? <span className="font-medium tabular-nums text-fg">{c.billingCourtId} <span className="text-emerald-500">✓</span></span>
            : <span className="font-medium text-amber-600 dark:text-amber-400">kiritilmagan ⚠</span>}
        </span>
        <span>· Cutoff <span className="font-medium tabular-nums text-fg">{hhmm(c.cutoffMinutes)}</span></span>
        <span>· {DOW.filter((d) => c.weekdays.includes(d.v)).map((d) => d.l).join(' ') || 'kun yoʻq'}</span>
      </div>

      {!c.billingReady && (
        <div className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-2.5 py-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
          <svg className="mt-0.5 h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><path d="M12 9v4M12 17h.01" /></svg>
          Billing «Sud id» kiritilmagan — bu sudning invoice'lari xato (default) sudga ketadi. Tahrirlab, real raqamni kiriting.
        </div>
      )}

      {/* Quota meter */}
      <div>
        <div className="mb-1 flex items-baseline justify-between text-[11px]">
          <span className="text-muted">Bugungi limit</span>
          <span className="tabular-nums">
            <span className="font-semibold text-fg">{n(c.usedToday)}</span>
            <span className="text-muted"> / {n(c.dailyQuota)}</span>
            {c.windowReason === 'ok' && <span className="ml-1 text-emerald-600 dark:text-emerald-400">· {n(remaining)} qoldi</span>}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
          <div className={`h-full rounded-full transition-all ${meterCls}`} style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Firms routing here */}
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">Firmalar</div>
        {c.firmIds.length === 0 ? (
          <span className="text-[11px] text-muted">{c.isDefault ? 'Ruxsatsiz firmalar shu yerga' : 'Biriktirilmagan'}</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {c.firmIds.map((fid) => (
              <span key={fid} className="rounded-full border border-line bg-surface-2/50 px-2 py-0.5 text-[11px] font-medium">{firmName.get(fid) ?? `#${fid}`}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── billing.sud.uz sud katalogidan tanlash (kaskad) — «Sud id» o'zi to'ladi ──────
interface CatalogCourt { id: number; name: string; address: string | null }
function CourtPicker({ onPick }: { onPick: (v: { billingCourtId: string; courtType: string; name: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<CatalogCourt[] | null>(null);
  const [q, setQ] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    if (items || err) return;
    try {
      const r = await fetch('/api/court-catalog');
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || 'Katalog olinmadi');
      setItems(Array.isArray(d.items) ? d.items : []);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Katalog olinmadi'); }
  };
  const filtered = (items ?? []).filter((c) => !q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase()) || String(c.id).includes(q.trim()));

  return (
    <div className="relative">
      <button type="button" onClick={() => { setOpen((v) => !v); load(); }}
        className="inline-flex items-center gap-1.5 rounded-lg border border-brand-500/30 bg-brand-500/[0.06] px-2.5 py-1.5 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-500/12 dark:text-brand-300">
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
        billing.sud.uz'dan tanlash
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute left-0 top-full z-40 mt-1 w-[28rem] max-w-[92vw] overflow-hidden rounded-xl border border-line bg-surface shadow-2xl">
            <div className="border-b border-line p-2">
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Sud nomi yoki id (masalan «Uchtepa» / «Юқоричирчиқ»)…"
                className={`${inp} w-full text-sm`} />
              <div className="mt-1 px-1 text-[10px] text-muted">Faqat fuqarolik (CITIZEN) sudlari — boji shu turga ketadi.</div>
            </div>
            {err ? (
              <div className="p-4 text-xs text-rose-500">{err}</div>
            ) : items === null ? (
              <div className="p-4 text-xs text-muted">Yuklanmoqda…</div>
            ) : filtered.length === 0 ? (
              <div className="p-4 text-center text-xs text-muted">Topilmadi</div>
            ) : (
              <div className="max-h-72 overflow-y-auto divide-y divide-line">
                {filtered.slice(0, 100).map((c) => (
                  <button key={c.id} type="button"
                    onClick={() => { onPick({ billingCourtId: String(c.id), courtType: 'CITIZEN', name: c.name }); setOpen(false); }}
                    className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-2">
                    <span className="mt-0.5 shrink-0 rounded bg-brand-500/10 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-brand-600 dark:text-brand-400">{c.id}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium">{c.name}</span>
                      {c.address && <span className="block truncate text-[10px] text-muted">{c.address}</span>}
                    </span>
                  </button>
                ))}
                {filtered.length > 100 && <div className="px-3 py-2 text-center text-[10px] text-muted">Ko‘p natija — nomini aniqroq yozing.</div>}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Edit view ────────────────────────────────────────────────────────────────
function CourtEditor({ draft, firms, busy, onPatch, onSave, onCancel, isNew }: { draft: Draft; firms: Firm[]; busy: boolean; onPatch: (p: Partial<Draft>) => void; onSave: () => void; onCancel: () => void; isNew?: boolean }) {
  return (
    <div className="card border-brand-500/30 p-4 ring-1 ring-brand-500/10 lg:col-span-2">
      <div className="mb-3 text-sm font-semibold">{isNew ? 'Yangi sud' : 'Sudni tahrirlash'}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="field-label">Nomi (arizada)
          <input className={`${inp} mt-1 w-full`} value={draft.nameUz} onChange={(e) => onPatch({ nameUz: e.target.value })} placeholder="Fuqarolik ishlari boʻyicha … tumanlararo sudiga" />
        </label>
        <label className="field-label">Qisqa nom
          <input className={`${inp} mt-1 w-full`} value={draft.shortName} onChange={(e) => onPatch({ shortName: e.target.value })} placeholder="Uchtepa tumanlararo sudi" />
        </label>
      </div>
      {/* billing.sud.uz katalogidan tanlab, «Sud id» (va turi) o'zi to'ladi — qo'lda topish shart emas. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <CourtPicker onPick={(v) => onPatch({ billingCourtId: v.billingCourtId, courtType: v.courtType })} />
        <span className="text-[11px] text-muted">
          {draft.billingCourtId && /^\d+$/.test(draft.billingCourtId)
            ? <span className="text-emerald-600 dark:text-emerald-400">Sud id: {draft.billingCourtId} ✓</span>
            : 'yoki quyida «Sud id»ni qoʻlda kiriting'}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="field-label">Sud id (billing)
          <input className={`${inp} mt-1 w-full tabular-nums`} value={draft.billingCourtId} onChange={(e) => onPatch({ billingCourtId: e.target.value })} placeholder="525" />
        </label>
        <label className="field-label">Kunlik limit
          <input type="number" min={0} className={`${inp} mt-1 w-full tabular-nums`} value={draft.dailyQuota} onChange={(e) => onPatch({ dailyQuota: Math.max(0, Number(e.target.value) || 0) })} />
        </label>
        <label className="field-label">Vaqt chegarasi
          <input type="time" className={`${inp} mt-1 w-full tabular-nums`} value={hhmm(draft.cutoffMinutes)} onChange={(e) => onPatch({ cutoffMinutes: toMin(e.target.value) })} />
        </label>
        <label className="field-label">Tartib
          <input type="number" className={`${inp} mt-1 w-full tabular-nums`} value={draft.sortOrder} onChange={(e) => onPatch({ sortOrder: Number(e.target.value) || 0 })} />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-1">
          <span className="mr-1 text-[11px] text-muted">Ish kunlari:</span>
          {DOW.map((d) => {
            const on = draft.weekdays.includes(d.v);
            return (
              <button key={d.v} type="button" onClick={() => onPatch({ weekdays: on ? draft.weekdays.filter((x) => x !== d.v) : [...draft.weekdays, d.v] })}
                className={`h-7 w-8 rounded-lg text-[11px] font-medium transition-colors ${on ? 'bg-brand-500 text-white' : 'border border-line text-muted hover:border-brand-500/40'}`}>{d.l}</button>
            );
          })}
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-muted"><input type="checkbox" checked={draft.active} onChange={(e) => onPatch({ active: e.target.checked })} /> Active</label>
        <label className="flex items-center gap-1.5 text-[11px] text-muted"><input type="checkbox" checked={draft.isDefault} onChange={(e) => onPatch({ isDefault: e.target.checked })} /> Default (ruxsatsiz firmalar shunga)</label>
      </div>

      <div className="mt-3">
        <div className="mb-1.5 text-[11px] text-muted">Qaysi firmalar shu sudga chiqadi:</div>
        <div className="flex flex-wrap gap-1.5">
          {firms.map((f) => {
            const on = draft.firmIds.includes(f.id);
            return (
              <button key={f.id} type="button" onClick={() => onPatch({ firmIds: on ? draft.firmIds.filter((x) => x !== f.id) : [...draft.firmIds, f.id] })}
                className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ${on ? 'border-brand-500 bg-brand-500/10 text-brand-700 dark:text-brand-300' : 'border-line text-muted hover:border-brand-500/40'}`}>{f.shortName}</button>
            );
          })}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button onClick={onSave} disabled={busy} className="btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs">
          {busy && <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />} Saqlash
        </button>
        <button onClick={onCancel} disabled={busy} className="btn-ghost px-3 py-1.5 text-xs">Bekor</button>
      </div>
    </div>
  );
}
