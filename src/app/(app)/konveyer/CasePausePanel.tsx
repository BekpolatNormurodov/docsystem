'use client';

import React, { useState } from 'react';
import { useT } from '@/lib/i18n/client';

// ISH PAUZASI — mijoz kartasida (hujjatlar modali tepasida): pauzada bo'lsa sabab + «Pauzadan chiqarish»,
// bo'lmasa «Pauzaga qo'yish» (sabab majburiy). Pauzadagi ish ariza/paket, qoralama, sudga yuborish va
// talabnomaga tushmaydi — server tomoni: src/lib/case-pause.ts, POST /konveyer/case-pause.

export interface CasePauseInfo { reason: string; at: string | null; by: string | null }

const REASON_MAX = 300;
// Tez tanlash — eng ko'p uchraydigan sabablar (matnni keyin tahrirlash mumkin).
const PRESETS = [
  'Maʼlumot kutilmoqda',
  'Boʻsh shartnoma: sana/summa yoʻq — maʼlumot kutilmoqda',
  'Foiz stavkasi yoʻq — maʼlumot kutilmoqda',
  'Toʻliq manzil kutilmoqda',
];

const fmt = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const PauseIcon = ({ className = 'h-4 w-4' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="9" /><path d="M10 9v6M14 9v6" />
  </svg>
);

export function CasePausePanel({ caseId, pause, onSaved }: {
  caseId: number;
  pause: CasePauseInfo | null;
  /** Saqlangandan keyin — yangi holat (null = pauzadan chiqdi). */
  onSaved: (pause: CasePauseInfo | null) => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async (next: boolean) => {
    const text = reason.trim();
    if (next && !text) { setErr(t('Pauza sababini yozing')); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/konveyer/case-pause', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseIds: [caseId], pause: next, ...(next ? { reason: text } : {}) }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error || t('Saqlanmadi — qayta urinib ko‘ring.'));
      setEditing(false); setReason('');
      onSaved(next ? (d?.pause ?? { reason: text, at: new Date().toISOString(), by: null }) : null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('Saqlanmadi — qayta urinib ko‘ring.'));
    } finally {
      setBusy(false);
    }
  };

  if (pause) {
    return (
      <div className="mb-3 flex flex-wrap items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5">
        <span className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"><PauseIcon className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-amber-800 dark:text-amber-200">{t('Pauzada — hech qayerga yuborilmaydi')}</div>
          <div className="mt-0.5 whitespace-pre-wrap break-words text-sm text-fg">{pause.reason || '—'}</div>
          {(pause.at || pause.by) && (
            <div className="mt-0.5 text-[11px] text-muted">{[fmt(pause.at), pause.by].filter(Boolean).join(' · ')}</div>
          )}
          {err && <div className="mt-1 text-xs text-rose-600 dark:text-rose-300">{err}</div>}
        </div>
        <button
          type="button"
          onClick={() => save(false)}
          disabled={busy}
          className="shrink-0 rounded-lg border border-amber-500/50 px-3 py-1.5 text-xs font-semibold text-amber-800 outline-none transition-colors hover:bg-amber-500/15 focus-visible:ring-2 focus-visible:ring-amber-500/30 disabled:opacity-50 dark:text-amber-200"
        >
          {busy ? '…' : t('Pauzadan chiqarish')}
        </button>
      </div>
    );
  }

  if (!editing) {
    return (
      <div className="mb-3 flex justify-end">
        <button
          type="button"
          onClick={() => { setEditing(true); setErr(null); }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-muted outline-none transition-colors hover:border-amber-500/50 hover:text-amber-700 focus-visible:ring-2 focus-visible:ring-amber-500/30 dark:hover:text-amber-300"
          title={t('Ishni sabab bilan to‘xtatish: ariza, qoralama, sudga yuborish va talabnomaga tushmaydi')}
        >
          <PauseIcon className="h-3.5 w-3.5" /> {t('Pauzaga qo‘yish')}
        </button>
      </div>
    );
  }

  return (
    <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/[0.06] p-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold"><PauseIcon className="h-4 w-4 text-amber-600 dark:text-amber-400" /> {t('Pauzaga qo‘yish')}</div>
      <p className="mb-2 text-xs text-muted">{t('Pauzadagi ish ariza, qoralama, sudga yuborish va talabnomaga tushmaydi. Sabab ro‘yxatda ko‘rinadi.')}</p>
      <div className="mb-2 flex flex-wrap gap-1">
        {PRESETS.map((p) => (
          <button key={p} type="button" onClick={() => setReason(t(p))} className="rounded-md bg-surface-2 px-2 py-0.5 text-[11px] text-muted transition-colors hover:text-fg">{t(p)}</button>
        ))}
      </div>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value.slice(0, REASON_MAX))}
        rows={2}
        autoFocus
        aria-label={t('Pauza sababi')}
        placeholder={t('Sabab (masalan: shartnoma maʼlumoti kutilmoqda)')}
        className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-amber-500 focus:ring-2 focus:ring-amber-500/15"
      />
      <div className="mt-2 flex items-center gap-2">
        {err && <span className="text-xs text-rose-600 dark:text-rose-300">{err}</span>}
        <span className="ml-auto text-[11px] tabular-nums text-muted">{reason.length}/{REASON_MAX}</span>
        <button type="button" onClick={() => { setEditing(false); setReason(''); setErr(null); }} disabled={busy} className="btn-ghost text-xs">{t('Bekor')}</button>
        <button
          type="button"
          onClick={() => save(true)}
          disabled={busy || !reason.trim()}
          className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-600 disabled:opacity-50"
        >
          {busy ? t('Saqlanmoqda…') : t('Pauzaga qo‘yish')}
        </button>
      </div>
    </div>
  );
}
