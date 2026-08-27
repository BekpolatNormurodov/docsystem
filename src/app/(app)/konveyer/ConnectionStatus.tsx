'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Modal } from '@/ui';
import { KeyPicker } from './KeyPicker';

type State = 'ACTIVE' | 'EXPIRED' | 'NONE';
interface Prov { state: State; since: string | null; expiresAt: string | null; balance?: number | null; name?: string | null }
interface Row { firmId: number; firmName: string; stir?: string | null; hippo: Prov; cabinet: Prov }

const n = (x: number) => x.toLocaleString('ru-RU');
const pad = (x: number) => String(x).padStart(2, '0');
const dtShort = (iso: string | null) => { if (!iso) return '—'; const d = new Date(iso); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const timeOnly = (iso: string | null) => { if (!iso) return '—'; const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

const LABEL: Record<State, string> = { ACTIVE: 'ulangan', EXPIRED: 'muddati o‘tgan', NONE: 'ulanmagan' };
const DOT: Record<State, string> = { ACTIVE: 'bg-emerald-500', EXPIRED: 'bg-amber-500', NONE: 'bg-slate-400' };
const PILL: Record<State, string> = {
  ACTIVE: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  EXPIRED: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  NONE: 'bg-surface-2 text-muted',
};

function Provider({ label, p, extra, onConnect, busy }: { label: string; p: Prov; extra?: string; onConnect: () => void; busy: boolean }) {
  // "which time's data": show the session's validity/last-change time.
  const timeNote = p.state === 'ACTIVE'
    ? (p.expiresAt ? `amal qiladi ${dtShort(p.expiresAt)} gacha` : (p.since ? `ulangan ${dtShort(p.since)}` : ''))
    : p.state === 'EXPIRED'
      ? (p.since ? `${dtShort(p.since)} da eskirgan` : 'muddati o‘tgan')
      : '';
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="w-16 shrink-0 text-[11px] font-medium text-muted">{label}</span>
      <span className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${PILL[p.state]}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${DOT[p.state]}`} />{LABEL[p.state]}
      </span>
      {extra && <span className="text-[11px] font-medium tabular-nums">{extra}</span>}
      {timeNote && <span className="truncate text-[10px] tabular-nums text-muted">{timeNote}</span>}
      {/* Always show a connect affordance: NONE → «Ula», EXPIRED → «Qayta ula» (amber), and ACTIVE too
          → «Qayta ula» (muted) so admin can re-sign with a DIFFERENT key/account (e.g. an account that
          actually holds the talabnoma template) without first disconnecting. */}
      <button
        onClick={onConnect}
        disabled={busy}
        aria-label={p.state === 'NONE' ? 'Ula' : 'Qayta ula'}
        title={p.state === 'NONE' ? 'Kalitni ula (E-IMZO)' : p.state === 'EXPIRED' ? 'Qayta ula — token eskirgan (E-IMZO)' : 'Qayta ula — boshqa kalit/akkaunt bilan (E-IMZO)'}
        className={`ml-auto grid h-6 w-6 shrink-0 place-items-center rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:opacity-50 ${p.state === 'NONE' ? 'text-brand-600 hover:bg-brand-500/12 dark:text-brand-400' : p.state === 'EXPIRED' ? 'text-amber-600 hover:bg-amber-500/15 dark:text-amber-400' : 'text-muted hover:bg-surface-2 hover:text-brand-600 dark:hover:text-brand-400'}`}
      >
        {busy
          ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          : p.state === 'NONE'
            ? <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" /><path d="M6 7h12l-1 9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 7Z" /><path d="M12 12v3" /></svg>
            : <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 21v-5h5" /></svg>}
      </button>
    </div>
  );
}

/**
 * E-IMZO connection status for xat.hippo + adolat (cabinet.sud.uz), per firm.
 *
 * Two shells over the same body:
 *  - default: a compact pill that opens the status in a Modal (header/inline use).
 *  - `inline`: renders the grid directly on its own page (the Ulanishlar sidebar route) — no pill,
 *    no modal, with a page heading instead of the Modal's title.
 */
export function ConnectionStatus({ inline = false }: { inline?: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [healthBusy, setHealthBusy] = useState(false);
  const [picker, setPicker] = useState<{ firmId: number; firmName: string; stir: string | null; provider: 'HIPPO' | 'CABINET' } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // On the dedicated page (inline) show every firm by default; the compact pill/modal still
  // starts connected-first with a "show the rest" toggle.
  const [showAll, setShowAll] = useState(inline);

  const load = useCallback(async (health = false) => {
    if (health) setHealthBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/konveyer/connections${health ? '?health=1' : ''}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Server xatosi (${res.status})`);
      const data = await res.json();
      setRows(data.firms ?? []);
      setCheckedAt(data.checkedAt ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Yuklab bo‘lmadi');
    } finally { setLoading(false); setHealthBusy(false); }
  }, []);
  useEffect(() => { load(false); }, [load]);

  // «Ula» opens the key-picker (list real DSKEYS files → pick the firm's key →
  // native E-IMZO password). No more blind STIR auto-match that failed silently.
  const openPicker = (firmId: number, firmName: string, stir: string | null, provider: 'HIPPO' | 'CABINET') => {
    setNote(null); setErr(null);
    setPicker({ firmId, firmName, stir, provider });
  };
  const onPickerSuccess = async (provider: 'HIPPO' | 'CABINET') => {
    setNote(`${provider === 'HIPPO' ? 'xat.hippo' : 'adolat'} ulandi ✓`);
    await load(true);
  };

  const hippoOk = rows.filter((r) => r.hippo.state === 'ACTIVE').length;
  const cabOk = rows.filter((r) => r.cabinet.state === 'ACTIVE').length;
  const anyExpired = rows.some((r) => r.hippo.state === 'EXPIRED' || r.cabinet.state === 'EXPIRED');
  const overall: State = hippoOk + cabOk > 0 ? (anyExpired ? 'EXPIRED' : 'ACTIVE') : 'NONE';
  const connected = rows.filter((r) => r.hippo.state !== 'NONE' || r.cabinet.state !== 'NONE');
  const rest = rows.filter((r) => r.hippo.state === 'NONE' && r.cabinet.state === 'NONE');
  const list = showAll ? rows : connected;

  const body = (
    <>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-[11px] tabular-nums text-muted">{checkedAt ? `Ma'lumot: ${timeOnly(checkedAt)} holatiga` : ''}</span>
        <button onClick={() => load(true)} disabled={healthBusy} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-muted outline-none transition-colors hover:border-brand-500/40 focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:opacity-50">
          {healthBusy ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> : null}
          Jonli tekshirish
        </button>
      </div>
      {note && <div role="status" className="mb-2 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.04] px-2.5 py-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">{note}</div>}
      {err && (
        <div role="alert" className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-rose-500/25 bg-rose-500/[0.04] px-2.5 py-1.5 text-[11px] font-medium text-rose-500">
          <span>{err}</span>
          <button onClick={() => load(false)} className="shrink-0 rounded border border-line px-1.5 py-0.5 text-muted hover:border-brand-500/40">Qayta urinish</button>
        </div>
      )}

      {loading ? (
        <div className="grid gap-2 sm:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-surface-2" />)}</div>
      ) : err && list.length === 0 ? null /* error banner above covers it — no contradictory "nothing connected" */
      : list.length === 0 ? (
        <div className="grid h-20 place-items-center text-center text-xs text-muted">Hali birorta firma kaliti ulanmagan.</div>
      ) : (
        <div className={`grid gap-2 sm:grid-cols-2 ${inline ? '' : 'max-h-[55vh] overflow-auto'}`}>
          {list.map((r) => (
            <div key={r.firmId} className="rounded-xl border border-line bg-surface px-3 py-2">
              <div className="mb-1 truncate text-[13px] font-semibold" title={r.firmName}>{r.firmName}</div>
              <Provider label="xat.hippo" p={r.hippo} extra={r.hippo.balance != null ? `${n(r.hippo.balance)} so‘m` : undefined} onConnect={() => openPicker(r.firmId, r.firmName, r.stir ?? null, 'HIPPO')} busy={picker?.firmId === r.firmId && picker?.provider === 'HIPPO'} />
              <Provider label="adolat" p={r.cabinet} onConnect={() => openPicker(r.firmId, r.firmName, r.stir ?? null, 'CABINET')} busy={picker?.firmId === r.firmId && picker?.provider === 'CABINET'} />
            </div>
          ))}
        </div>
      )}
      {!loading && rest.length > 0 && (
        <button onClick={() => setShowAll((v) => !v)} className="mt-2 text-[11px] font-medium text-muted hover:text-brand-600">
          {showAll ? 'Faqat ulanganlar' : `Yana ${rest.length} ta ulanmagan firma`}
        </button>
      )}
      <div className="mt-2 text-[11px] text-muted">«Ula» — kalit roʻyxatidan firma kalitini tanlaysiz, soʻng E-IMZO oynasida parol soʻraladi (kalit ulangan boʻlishi shart).</div>
    </>
  );

  // The picker is rendered as a SIBLING of the shell (never a child of the pill Modal): it is
  // controlled by `picker`, so closing the outer connections modal (Esc/backdrop) can't unmount
  // an in-flight sign, and its own Modal owns its Esc handling.
  const pickerEl = picker && (
    <KeyPicker
      open
      onClose={() => setPicker(null)}
      firm={{ firmId: picker.firmId, firmName: picker.firmName, stir: picker.stir }}
      provider={picker.provider}
      endpoint="/konveyer/connect"
      title={picker.provider === 'HIPPO' ? 'xat.hippo — kalitni ulash' : 'adolat (sud) — kalitni ulash'}
      confirmLabel="Imzolab ulash"
      onSuccess={() => onPickerSuccess(picker.provider)}
    />
  );

  if (inline) {
    return (
      <div>
        <div className="mb-4">
          <h1 className="text-2xl font-bold tracking-tight">Ulanishlar — E-IMZO</h1>
          <p className="mt-1 text-sm text-muted">xat.hippo va adolat (cabinet.sud.uz) — firma kaliti bilan</p>
        </div>
        <div className="card p-4 sm:p-5">{body}</div>
        {pickerEl}
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium outline-none transition-colors hover:border-brand-500/40 focus-visible:ring-2 focus-visible:ring-brand-500/30"
        title="E-IMZO ulanishlari"
      >
        <span className={`h-2 w-2 rounded-full ${DOT[overall]} ${overall === 'ACTIVE' ? 'animate-pulse' : ''}`} />
        <svg className="h-4 w-4 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" /><path d="M6 7h12l-1 9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 7Z" /><path d="M12 12v3" /></svg>
        <span className="tabular-nums text-muted">hippo {hippoOk} · adolat {cabOk}</span>
      </button>

      <Modal open={open} onClose={() => setOpen(false)} size="lg" title="Ulanishlar — E-IMZO" description="xat.hippo va adolat (cabinet.sud.uz) — firma kaliti bilan">
        {body}
      </Modal>
      {pickerEl}
    </>
  );
}
