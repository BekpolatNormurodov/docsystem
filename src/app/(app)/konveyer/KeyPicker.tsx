'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '@/ui';

// One E-IMZO key file visible on the machine (from GET /konveyer/keys, or — in client
// mode — from window.EimzoBrowser.listKeys() on the USER's machine).
export interface EimzoKey {
  disk: string; path: string; name: string; alias: string;
  cn: string | null; org: string | null; tin: string | null;
  pinfl?: string | null; // present in client-mode enumeration
  validFrom: string | null; validTo: string | null;
}

// The exact bytes the hippo frontend signs (mirrors HIPPO.signData in src/lib/hippo/login.ts).
// Client mode signs this constant in-browser for the hippo login.
const HIPPO_SIGN_DATA = 'TezDoc E-IMZO orqali kirish';

// window.EimzoBrowser is installed by /e-imzo/eimzo-browser.js (loaded only in client mode).
declare global {
  interface Window {
    EimzoBrowser?: {
      listKeys: () => Promise<EimzoKey[]>;
      sign: (picked: EimzoKey, data: string, detached: 'yes' | 'no') => Promise<string>;
      parseAlias?: (alias: string) => unknown;
    };
    __EIMZO_API_KEY__?: string;
  }
}

// Inject the browser CAPIWS client once (idempotent). Resolves when window.EimzoBrowser
// is available. Only used in client mode.
let browserClientPromise: Promise<void> | null = null;
function loadBrowserClient(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.EimzoBrowser) return Promise.resolve();
  if (browserClientPromise) return browserClientPromise;
  browserClientPromise = new Promise<void>((resolve, reject) => {
    // On failure REMOVE the dead <script> and null the cached promise, so a retry starts a
    // FRESH script. Without this, a retry re-attaches listeners to an already-settled script
    // that never re-fires → the cached promise never resolves and the modal spins forever.
    const fail = (script?: HTMLScriptElement | null) => {
      script?.remove();
      browserClientPromise = null;
      reject(new Error('E-IMZO brauzer klienti yuklanmadi'));
    };
    const existing = document.querySelector<HTMLScriptElement>('script[data-eimzo-browser]');
    const done = () => (window.EimzoBrowser ? resolve() : fail(document.querySelector<HTMLScriptElement>('script[data-eimzo-browser]')));
    if (existing) {
      if (window.EimzoBrowser) return resolve();
      existing.addEventListener('load', done, { once: true });
      existing.addEventListener('error', () => fail(existing), { once: true });
      return;
    }
    const s = document.createElement('script');
    s.src = '/e-imzo/eimzo-browser.js';
    s.async = true;
    s.dataset.eimzoBrowser = '1';
    s.onload = done;
    s.onerror = () => fail(s);
    document.head.appendChild(s);
  });
  return browserClientPromise;
}

// Bound a promise so the client-key load path can never hang indefinitely (e.g. a script
// that stays pending forever). Rejects with a clear error → the caller surfaces an error phase.
function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(msg)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

type Phase = 'loading' | 'ready' | 'signing' | 'done' | 'error';

const digits = (s?: string | null) => (s ?? '').replace(/\D+/g, '');
const keyId = (k: EimzoKey) => `${k.disk}|${k.path}|${k.name}`;

const IcoKey = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><circle cx="7.5" cy="15.5" r="4.5" /><path d="m21 2-9.6 9.6" /><path d="m15.5 7.5 3 3L22 7l-3-3" /></svg>
);
const IcoShield = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></svg>
);
const IcoCheck = () => (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
);
const IcoWarn = () => (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>
);

/**
 * E-IMZO key picker — the shared «kalitni tanlab, parolni terib» gate.
 *
 * Lists the real DSKEYS key files by name (prefix), pre-selects the one matching
 * the firm's STIR, and on confirm POSTs the CHOSEN key to `endpoint`. The server's
 * signing step opens E-IMZO's native password dialog; every phase is shown so the
 * flow is never a silent spinner. Used by both «Ula» (connections) and «Sudga
 * yuborish» (court).
 */
export function KeyPicker({
  open, onClose, firm, provider, endpoint, title, confirmLabel, onSuccess, summary,
}: {
  open: boolean;
  onClose: () => void;
  firm: { firmId: number; firmName: string; stir?: string | null };
  provider: 'HIPPO' | 'CABINET';
  endpoint: string;
  title: string;
  confirmLabel: string;
  onSuccess: (result: any) => void;
  summary?: React.ReactNode; // «aniq so'roq» — nima tasdiqlanayotgani (kalit tanlash tepasida)
}) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [keys, setKeys] = useState<EimzoKey[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);              // live E-IMZO re-scan in flight
  const [syncErr, setSyncErr] = useState<string | null>(null); // live re-scan failed → showing cached
  const [diag, setDiag] = useState<{ disks: unknown; perDisk: { disk: string; count: number; error?: string }[] } | null>(null); // why the scan was empty
  const [clientMode, setClientMode] = useState(false);        // server has no local E-IMZO → enumerate/sign in the browser
  const keysCountRef = useRef(0);                              // lets the async catch know if cached keys are shown

  const wantStir = digits(firm.stir);
  const matches = useCallback((k: EimzoKey) => !!wantStir && digits(k.tin) === wantStir, [wantStir]);

  // Apply a list without clobbering the operator's current pick if it's still present; firm's key first.
  const applyList = useCallback((list: EimzoKey[]) => {
    // Show ONLY this firm's keys (STIR match) — other firms' keys are hidden entirely. Fallback to the
    // full list if NONE match (e.g. a key whose STIR didn't parse), so the picker is never left empty.
    const own = wantStir ? list.filter(matches) : list;
    const shown = own.length ? own : list;
    const sorted = [...shown].sort((a, b) => (matches(b) ? 1 : 0) - (matches(a) ? 1 : 0));
    keysCountRef.current = sorted.length;
    setKeys(sorted);
    setSel((prev) => {
      if (prev && sorted.some((k) => keyId(k) === prev)) return prev;
      const mine = sorted.find(matches);
      return mine ? keyId(mine) : (sorted[0] ? keyId(sorted[0]) : null);
    });
  }, [matches, wantStir]);

  // Live E-IMZO re-scan (slow) — server re-scans DSKEYS and re-caches. 20s hard ceiling so it never freezes.
  const refreshLive = useCallback(async () => {
    setSyncing(true); setSyncErr(null);
    const ctrl = new AbortController();
    // Healthy scan responds in ~1-2s; if nothing comes back in 25s it's genuinely stuck — abort and
    // show the error instead of spinning. (Cached keys, if any, stay on screen.)
    const t = setTimeout(() => ctrl.abort(), 25_000);
    try {
      const res = await fetch('/konveyer/keys?refresh=1', { cache: 'no-store', signal: ctrl.signal });
      const d = await res.json().catch(() => ({}));
      const list: EimzoKey[] = d.keys ?? [];
      if (!res.ok && !list.length) throw new Error(d?.error || `Server xatosi (${res.status})`);
      setDiag(d.debug ?? null);
      applyList(list);
      if (list.length) { setPhase('ready'); if (d.staleError) setSyncErr(d.staleError); }
      else { setErr(d.staleError || d.error || 'Kalit topilmadi — DSKEYS boʻsh yoki kalit ulanmagan.'); setPhase('error'); }
    } catch (e) {
      const aborted = e instanceof Error && e.name === 'AbortError';
      const m = aborted ? 'E-IMZO javob bermadi (juda sekin) — dastur ochiqligini tekshiring.' : (e instanceof Error ? e.message : 'E-IMZO dan yangilanmadi');
      // Keep the cached keys usable if we have them; otherwise surface the error.
      if (keysCountRef.current > 0) setSyncErr(m);
      else { setErr(m); setPhase('error'); }
    } finally { clearTimeout(t); setSyncing(false); }
  }, [applyList]);

  // CLIENT MODE: enumerate keys from the USER's own E-IMZO (window.EimzoBrowser), not the
  // server. Slow-ish (loads a script + scans DSKEYS) but never touches a server CAPIWS.
  const loadKeysClient = useCallback(async () => {
    setSyncing(true); setSyncErr(null); setErr(null);
    try {
      if (typeof window !== 'undefined') window.__EIMZO_API_KEY__ = process.env.NEXT_PUBLIC_EIMZO_API_KEY || '';
      // Bounded so a stuck script load surfaces an error phase instead of spinning forever.
      await withTimeout(loadBrowserClient(), 20_000, 'E-IMZO brauzer klienti yuklanmadi (vaqt tugadi)');
      const eb = typeof window !== 'undefined' ? window.EimzoBrowser : undefined;
      if (!eb) throw new Error('E-IMZO brauzer klienti yuklanmadi');
      const list = await eb.listKeys();
      applyList(list);
      if (list.length) setPhase('ready');
      else { setErr('Kalit topilmadi — E-IMZO dasturini oching va kalitni (token/ID-karta) ulang.'); setPhase('error'); }
    } catch (e) {
      const m = e instanceof Error ? e.message : 'E-IMZO dan oʻqib boʻlmadi';
      if (keysCountRef.current > 0) setSyncErr(m);
      else { setErr(m); setPhase('error'); }
    } finally { setSyncing(false); }
  }, [applyList]);

  // Open → show the server-cached snapshot INSTANTLY (no E-IMZO wait), then verify/update live.
  // In client mode, detect the flag and switch to browser enumeration instead.
  const loadKeys = useCallback(async () => {
    setPhase('loading'); setErr(null); setSyncErr(null);
    try {
      const res = await fetch('/konveyer/keys', { cache: 'no-store' }); // cached, instant
      const d = await res.json().catch(() => ({}));
      if (d.clientMode) { setClientMode(true); await loadKeysClient(); return; }
      const list: EimzoKey[] = d.keys ?? [];
      if (list.length) { applyList(list); setPhase('ready'); }
    } catch { /* cache miss/error → the live scan below populates or errors */ }
    refreshLive();
  }, [applyList, refreshLive, loadKeysClient]);

  // Fresh load every time the dialog opens (a key may have just been inserted).
  useEffect(() => {
    if (!open) return;
    setKeys([]); setSel(null); setErr(null); setSyncErr(null); setDiag(null); keysCountRef.current = 0;
    loadKeys();
  }, [open, loadKeys]);

  const chosen = useMemo(() => keys.find((k) => keyId(k) === sel) ?? null, [keys, sel]);
  const chosenStir = digits(chosen?.tin);
  // Block signing a key that isn't THIS firm's legal-entity key (server hard-rejects it too) —
  // catch it here so the operator never opens the native PIN dialog for a doomed sign.
  const mismatch = !!wantStir && !!chosen && chosenStir !== wantStir;

  const sign = useCallback(async () => {
    if (!chosen) return;
    setPhase('signing'); setErr(null);
    try {
      let d: any;
      if (clientMode) {
        // CLIENT MODE: sign on the USER's own machine, POST only the finished PKCS7.
        const eb = typeof window !== 'undefined' ? window.EimzoBrowser : undefined;
        if (!eb) throw new Error('E-IMZO brauzer klienti yuklanmadi');
        const cert = { cn: chosen.cn, org: chosen.org, tin: chosen.tin, pinfl: chosen.pinfl ?? null };
        let pkcs7: string;
        let challengeId: string | undefined;
        if (provider === 'HIPPO') {
          // hippo signs a fixed public constant, detached='yes'.
          pkcs7 = await eb.sign(chosen, HIPPO_SIGN_DATA, 'yes');
        } else {
          // cabinet needs a SERVER-minted, cookie-bound challenge first, detached='no'.
          const chRes = await fetch('/konveyer/connect/challenge', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ firmId: firm.firmId, provider }),
          });
          const chD = await chRes.json().catch(() => ({}));
          if (!chRes.ok || !chD?.challenge) throw new Error(chD?.error || `Challenge olinmadi (${chRes.status})`);
          challengeId = chD.challengeId;
          pkcs7 = await eb.sign(chosen, chD.challenge, 'no');
        }
        const res = await fetch(endpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ firmId: firm.firmId, provider, pkcs7, challengeId, cert }),
        });
        d = await res.json().catch(() => ({}));
        if (!res.ok || d?.ok === false) throw new Error(d?.error || `Ulanmadi (${res.status})`);
      } else {
        // SERVER MODE (unchanged): the server signs via its local E-IMZO.
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ firmId: firm.firmId, provider, key: chosen }),
        });
        d = await res.json().catch(() => ({}));
        if (!res.ok || d?.ok === false) throw new Error(d?.error || `Ulanmadi (${res.status})`);
      }
      setPhase('done');
      onSuccess(d);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Imzolanmadi');
      setPhase('ready'); // back to the list so they can retry or pick another key
    }
  }, [chosen, endpoint, firm.firmId, provider, onSuccess, clientMode]);

  const busy = phase === 'signing';

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      size="lg"
      title={title}
      description={`${firm.firmName}${wantStir ? ` · STIR ${wantStir}` : ''} — ${provider === 'HIPPO' ? 'xat.hippo' : 'adolat (sud)'} kaliti`}
      footer={
        phase === 'done' ? (
          <button onClick={onClose} className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600">Yopish</button>
        ) : (
          <>
            <button onClick={onClose} disabled={busy} className="btn-ghost text-sm disabled:opacity-40">Bekor</button>
            <button
              onClick={sign}
              disabled={busy || !chosen || phase === 'loading' || mismatch}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <IcoShield />}
              {busy ? 'E-IMZO…' : confirmLabel}
            </button>
          </>
        )
      }
    >
      {phase === 'loading' ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-muted">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            E-IMZO kalitlarni oʻqiyapti…
          </div>
          <div className="text-[12px] text-muted/80">Birinchi safar biroz sekin (barcha kalitlar tekshiriladi) — keyingi safar darrov ochiladi.</div>
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-surface-2" />)}
        </div>
      ) : phase === 'error' ? (
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-xl border border-rose-500/25 bg-rose-500/[0.05] px-3 py-2.5 text-sm text-rose-600 dark:text-rose-300">
            <span className="mt-0.5 shrink-0"><IcoWarn /></span>
            <div>
              <div className="font-semibold">Kalitlar olinmadi</div>
              <div className="mt-0.5 text-[13px] opacity-90">{err}</div>
              <div className="mt-1 text-[12px] text-muted">E-IMZO dasturi ishga tushganini va kalit (token/ID-karta) ulanganini tekshiring.</div>
            </div>
          </div>
          {diag && (
            <div className="rounded-lg border border-line bg-surface-2/40 px-3 py-2 text-[12px]">
              <div className="mb-1 font-semibold text-muted">E-IMZO diagnostika</div>
              <div className="text-muted">list_disks: <span className="font-mono text-fg">{JSON.stringify(diag.disks)}</span></div>
              {(diag.perDisk ?? []).length === 0
                ? <div className="mt-0.5 text-amber-600 dark:text-amber-400">E-IMZO hech qanday disk qaytarmadi (DSKEYS'li disk topilmadi). C:\DSKEYS bo'lsa ham E-IMZO uni ko'rmayapti — E-IMZO'ni qayta ishga tushiring / yangilang.</div>
                : (diag.perDisk ?? []).map((p) => (
                  <div key={p.disk} className="mt-0.5 font-mono text-fg">{p.disk}: {p.error ? <span className="text-rose-500">xato — {p.error}</span> : `${p.count} ta sertifikat`}</div>
                ))}
            </div>
          )}
          <button onClick={() => { setPhase('loading'); setErr(null); if (clientMode) loadKeysClient(); else refreshLive(); }} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-muted hover:border-brand-500/40 hover:text-fg">
            Qayta urinish
          </button>
        </div>
      ) : phase === 'done' ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"><IcoCheck /></span>
          <div className="text-sm font-semibold">Imzolandi ✓</div>
          <div className="text-[13px] text-muted">{chosen?.org || chosen?.cn || chosen?.name}</div>
        </div>
      ) : (
        <div className="space-y-2">
          {err && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-500/25 bg-rose-500/[0.05] px-3 py-2 text-[13px] font-medium text-rose-600 dark:text-rose-300" role="alert">
              <span className="mt-0.5 shrink-0"><IcoWarn /></span><span>{err}</span>
            </div>
          )}
          {syncing && !busy && (
            <div className="flex items-center gap-2 rounded-lg border border-sky-500/25 bg-sky-500/[0.05] px-3 py-2 text-[12px] font-medium text-sky-600 dark:text-sky-400">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
              E-IMZO dan yangilanyapti…
            </div>
          )}
          {!syncing && syncErr && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.05] px-3 py-2 text-[12px] font-medium text-amber-700 dark:text-amber-300">
              <span className="mt-0.5 shrink-0"><IcoWarn /></span>
              <span>Oxirgi (saqlangan) roʻyxat koʻrsatilyapti — E-IMZO dan yangilab boʻlmadi.</span>
            </div>
          )}
          {busy && (
            <div className="flex items-center gap-2 rounded-lg border border-brand-500/25 bg-brand-500/[0.05] px-3 py-2 text-[13px] font-medium text-brand-600 dark:text-brand-400">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
              E-IMZO oynasida parolni kiriting… (oyna orqada qolishi mumkin)
            </div>
          )}
          {mismatch && !busy && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-[13px] font-medium text-amber-700 dark:text-amber-300">
              <span className="mt-0.5 shrink-0"><IcoWarn /></span>
              <span>Tanlangan kalit {chosenStir ? `(STIR ${chosenStir})` : '(firma STIRi yoʻq)'} bu firmaga ({wantStir}) mos emas — {firm.firmName} kalitini tanlang.</span>
            </div>
          )}
          {summary && (
            <div className="flex items-start gap-2 rounded-xl border border-brand-500/25 bg-brand-500/[0.05] px-3 py-2.5 text-[13px] font-medium text-fg">
              <span className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-400"><IcoShield /></span>
              <span>{summary}</span>
            </div>
          )}
          <div className="text-[12px] text-muted">Kalitni tanlang — parol E-IMZO oynasida soʻraladi:</div>
          <div className="max-h-[46vh] space-y-1.5 overflow-auto pr-0.5">
            {keys.map((k) => {
              const id = keyId(k);
              const active = sel === id;
              const mine = matches(k);
              return (
                <button
                  key={id}
                  type="button"
                  disabled={busy}
                  onClick={() => setSel(id)}
                  className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-60 ${active ? 'border-brand-500 bg-brand-500/[0.06] ring-1 ring-brand-500/30' : 'border-line bg-surface hover:border-brand-500/40'}`}
                >
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${active ? 'bg-brand-500/15 text-brand-600 dark:text-brand-400' : 'bg-surface-2 text-muted'}`}><IcoKey /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold" title={k.org || k.cn || k.name}>{k.org || k.cn || k.name}</span>
                      {mine && <span className="shrink-0 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">shu firma</span>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
                      {k.cn && k.cn !== k.org && <span className="truncate">{k.cn}</span>}
                      {k.tin && <span className="tabular-nums">STIR {k.tin}</span>}
                      <span className="truncate rounded bg-surface-2 px-1.5 py-0.5" title={`${k.disk} · ${k.name}`}>{k.name}</span>
                      {k.validTo && <span className="tabular-nums">→ {k.validTo}</span>}
                    </div>
                  </div>
                  <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${active ? 'border-brand-500 bg-brand-500 text-white' : 'border-line'}`}>
                    {active && <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </Modal>
  );
}
