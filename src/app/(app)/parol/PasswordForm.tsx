'use client';

import React, { useState } from 'react';
import { Ico } from '@/ui/icons';

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');
const initials = (s: string) => s.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
const inputCls = 'w-full rounded-lg border border-line bg-surface py-2 pl-3 pr-10 text-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15';

function PwField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      <div className="relative">
        <input className={inputCls} type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete="off" />
        <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Yashirish' : 'Ko‘rsatish'} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted transition-colors hover:text-fg">
          {show ? <Ico.eyeOff size={16} /> : <Ico.eye size={16} />}
        </button>
      </div>
    </label>
  );
}

export function PasswordForm({ username, fullName, roleLabel }: { username: string; fullName: string; roleLabel: string }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const canSubmit = current.length > 0 && next.length >= 4 && next === confirm && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    if (next !== confirm) { setErr('Yangi parol tasdiqlash bilan mos emas'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/users/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current, next }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error || 'Saqlanmadi');
      setMsg('Parol o‘zgartirildi ✓');
      setCurrent(''); setNext(''); setConfirm('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Xatolik');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-md">
      <div className="mb-4 flex items-center gap-3 rounded-xl border border-line bg-surface p-4">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-500 text-sm font-semibold text-white shadow-sm">{initials(fullName || username)}</div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{fullName || username}</div>
          <div className="truncate text-xs text-muted">@{username} · {roleLabel}</div>
        </div>
      </div>

      <form onSubmit={submit} className="space-y-3.5 rounded-xl border border-line bg-surface p-5">
        <PwField label="Joriy parol" value={current} onChange={setCurrent} placeholder="Hozirgi parolingiz" />
        <PwField label="Yangi parol" value={next} onChange={setNext} placeholder="Kamida 4 belgi" />
        <PwField label="Yangi parolni tasdiqlang" value={confirm} onChange={setConfirm} placeholder="Yangi parolni qayta kiriting" />

        {next.length > 0 && confirm.length > 0 && next !== confirm && (
          <div className="text-xs font-medium text-amber-600 dark:text-amber-400">Parollar mos emas</div>
        )}
        {err && <div role="alert" className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs font-medium text-rose-500"><Ico.info size={15} /> {err}</div>}
        {msg && <div role="status" className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs font-medium text-emerald-600 dark:text-emerald-400"><Ico.check size={15} /> {msg}</div>}

        <button type="submit" disabled={!canSubmit} className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:opacity-50">
          {busy && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/60 border-t-transparent" />}
          Parolni o‘zgartirish
        </button>
      </form>
    </div>
  );
}
