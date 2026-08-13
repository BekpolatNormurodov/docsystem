'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Ico } from '@/ui/icons';
import { useConfirm } from '@/ui';
import { STEP_KEYS, STEP_META, type StepKey } from '@/lib/access';

export interface UserRow {
  id: number;
  username: string;
  role: 'ADMIN' | 'YURIST';
  fullName: string;
  steps: StepKey[];
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');
const initials = (name: string) =>
  name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

const AV = ['bg-rose-500', 'bg-amber-500', 'bg-emerald-500', 'bg-cyan-500', 'bg-brand-500', 'bg-indigo-500', 'bg-fuchsia-500'];
const avColor = (s: string) => AV[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % AV.length];

// Human "last seen" from an ISO timestamp (client-side; recomputed each render).
const relLogin = (iso: string | null) => {
  if (!iso) return 'hech qachon';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'hozir';
  if (s < 3600) return `${Math.floor(s / 60)} daq oldin`;
  if (s < 86400) return `${Math.floor(s / 3600)} soat oldin`;
  const days = Math.floor(s / 86400);
  return days < 30 ? `${days} kun oldin` : new Date(iso).toLocaleDateString('ru-RU');
};

// Caller passes size + a border color (top stays transparent to form the gap).
const Spinner = ({ className }: { className?: string }) => (
  <span className={cx('inline-block animate-spin rounded-full border-2 border-t-transparent', className)} />
);

// ── The galochka grid: admin ticks which pipeline steps a yurist may open ────
function StepToggles({ value, onChange, disabled }: { value: StepKey[]; onChange: (v: StepKey[]) => void; disabled?: boolean }) {
  const toggle = (k: StepKey) =>
    onChange(value.includes(k) ? value.filter((x) => x !== k) : STEP_KEYS.filter((x) => x === k || value.includes(x)));
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {STEP_KEYS.map((k) => {
        const on = value.includes(k);
        return (
          <button
            type="button"
            key={k}
            disabled={disabled}
            onClick={() => toggle(k)}
            aria-pressed={on}
            className={cx(
              'flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/30',
              on ? 'border-brand-500 bg-brand-500/10 text-fg shadow-sm' : 'border-line bg-surface text-muted hover:border-brand-500/40 hover:text-fg',
              disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            <span className={cx('grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors', on ? 'border-brand-500 bg-brand-500 text-white' : 'border-line text-transparent')}>
              <Ico.check size={13} />
            </span>
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-surface-2 text-[10px] font-semibold tabular-nums">{STEP_META[k].step}</span>
            <span className="truncate">{STEP_META[k].label}</span>
          </button>
        );
      })}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15';

function UserForm({ mode, initial, onDone, onCancel }: { mode: 'add' | 'edit'; initial?: UserRow; onDone: () => void; onCancel: () => void }) {
  const [newUsername, setNewUsername] = useState('');
  const [fullName, setFullName] = useState(initial?.fullName ?? '');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [role, setRole] = useState<'ADMIN' | 'YURIST'>(initial?.role ?? 'YURIST');
  const [steps, setSteps] = useState<StepKey[]>(initial?.steps ?? []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const payload: Record<string, unknown> = { fullName, role, steps: role === 'YURIST' ? steps : [] };
      if (mode === 'add') {
        payload.username = newUsername.trim();
        payload.password = password;
      } else if (password) {
        payload.password = password;
      }
      const res = await fetch(mode === 'add' ? '/api/users' : `/api/users/${initial!.id}`, {
        method: mode === 'add' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error || 'Saqlanmadi');
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Xatolik');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-line bg-surface-2/40 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Login">
          {mode === 'add' ? (
            <input className={inputCls} value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder="masalan: mahmud" autoFocus />
          ) : (
            <input className={cx(inputCls, 'cursor-not-allowed opacity-60')} value={initial?.username ?? ''} readOnly />
          )}
        </Field>
        <Field label="F.I.Sh (ixtiyoriy)">
          <input className={inputCls} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Mahmudov Akmal" />
        </Field>
        <Field label={mode === 'add' ? 'Parol' : 'Yangi parol'}>
          <div className="relative">
            <input
              className={cx(inputCls, 'pr-10')}
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'add' ? 'Kamida 4 belgi' : 'Bo‘sh — o‘zgarmaydi'}
              autoComplete="new-password"
            />
            <button type="button" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? 'Yashirish' : 'Ko‘rsatish'} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted transition-colors hover:text-fg">
              {showPw ? <Ico.eyeOff size={16} /> : <Ico.eye size={16} />}
            </button>
          </div>
        </Field>
        <Field label="Rol">
          <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
            {(['YURIST', 'ADMIN'] as const).map((r) => (
              <button
                type="button"
                key={r}
                onClick={() => setRole(r)}
                className={cx('rounded-md px-4 py-1.5 text-sm font-medium transition-colors', role === r ? 'bg-brand-500 text-white shadow-sm' : 'text-muted hover:text-fg')}
              >
                {r === 'ADMIN' ? 'Admin' : 'Yurist'}
              </button>
            ))}
          </div>
        </Field>
      </div>

      {role === 'YURIST' ? (
        <div className="mt-4">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted">
            <Ico.check size={14} /> Bosqich ruxsatlari — galochka qo‘ying
          </div>
          <StepToggles value={steps} onChange={setSteps} disabled={busy} />
        </div>
      ) : (
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          <Ico.info size={15} /> Admin barcha bosqich va sahifalarni ko‘radi va boshqaradi.
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        <button onClick={submit} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:opacity-60">
          {busy && <Spinner className="h-3.5 w-3.5 border-white/60" />}
          {mode === 'add' ? 'Qo‘shish' : 'Saqlash'}
        </button>
        <button onClick={onCancel} disabled={busy} className="rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg">
          Bekor
        </button>
        {err && <span role="alert" className="ml-1 text-xs font-medium text-rose-500">{err}</span>}
      </div>
    </div>
  );
}

// ── One compact icon action ──────────────────────────────────────────────────
function IconBtn({ title, onClick, disabled, danger, active, children }: { title: string; onClick: () => void; disabled?: boolean; danger?: boolean; active?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'grid h-8 w-8 place-items-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:opacity-30',
        active ? 'bg-brand-500/15 text-brand-600 dark:text-brand-300'
        : danger ? 'text-muted hover:bg-rose-500/10 hover:text-rose-500'
        : 'text-muted hover:bg-surface-2 hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}

export function UsersManager({ users, meId }: { users: UserRow[]; meId: number }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [roleF, setRoleF] = useState<'all' | 'ADMIN' | 'YURIST'>('all');

  const refresh = () => router.refresh();

  const call = async (u: UserRow, init: RequestInit) => {
    setBusyId(u.id);
    setErr(null);
    try {
      const res = await fetch(`/api/users/${u.id}`, init);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error || 'Xatolik');
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Xatolik');
    } finally {
      setBusyId(null);
    }
  };

  const toggleActive = (u: UserRow) => call(u, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !u.active }) });
  const remove = async (u: UserRow) => {
    const ok = await confirm({
      title: 'Foydalanuvchini oʻchirish',
      description: `«${u.username}» foydalanuvchisi butunlay oʻchiriladi.`,
      confirmLabel: 'Oʻchirish', danger: true,
    });
    if (!ok) return;
    call(u, { method: 'DELETE' });
  };

  const admins = users.filter((u) => u.role === 'ADMIN').length;
  const yuristlar = users.filter((u) => u.role === 'YURIST').length;
  const blocked = users.filter((u) => !u.active).length;

  const nq = query.trim().toLowerCase();
  const shown = users.filter(
    (u) => (roleF === 'all' || u.role === roleF) && (!nq || u.username.toLowerCase().includes(nq) || u.fullName.toLowerCase().includes(nq)),
  );

  return (
    <div className="space-y-4">
      {/* One header row: search + role filter (with live counts) + add. The old top stat-strip is
          folded INTO the filter tabs (Barchasi/Admin/Yurist counts), so there's a SINGLE list below. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"><Ico.user size={15} /></span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ism yoki login boʻyicha qidirish…"
            className="w-full rounded-lg border border-line bg-surface py-2 pl-9 pr-3 text-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
          />
        </div>
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
          {([['all', 'Barchasi', users.length], ['ADMIN', 'Admin', admins], ['YURIST', 'Yurist', yuristlar]] as const).map(([r, label, cnt]) => (
            <button
              key={r}
              onClick={() => setRoleF(r)}
              className={cx('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors', roleF === r ? 'bg-brand-500 text-white' : 'text-muted hover:text-fg')}
            >
              {label} <span className="tabular-nums opacity-80">{cnt}</span>
            </button>
          ))}
        </div>
        {blocked > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-xs font-medium text-rose-500">
            <span className="h-1.5 w-1.5 rounded-full bg-rose-500" /> {blocked} bloklangan
          </span>
        )}
        <button
          onClick={() => { setAdding((v) => !v); setEditingId(null); }}
          className={cx(
            'ml-auto inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
            adding ? 'bg-surface-2 text-fg' : 'bg-brand-500 text-white hover:bg-brand-600',
          )}
        >
          <Ico.userAdd size={17} /> {adding ? 'Yopish' : 'Yangi foydalanuvchi'}
        </button>
      </div>

      {err && (
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-sm text-rose-500">
          <Ico.info size={16} /> {err}
        </div>
      )}

      {adding && (
        <div className="animate-fade-in">
          <UserForm mode="add" onDone={() => { setAdding(false); refresh(); }} onCancel={() => setAdding(false)} />
        </div>
      )}

      <div className="space-y-2.5">
        {shown.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">Hech kim topilmadi</div>
        ) : shown.map((u) => {
          const isMe = u.id === meId;
          const editing = editingId === u.id;
          const busy = busyId === u.id;
          return (
            <div
              key={u.id}
              className={cx(
                'card p-4 transition-all',
                editing ? 'border-brand-500/40 ring-1 ring-brand-500/15' : 'hover:border-brand-500/25 hover:shadow-sm',
                !u.active && !editing && 'opacity-65',
              )}
            >
              <div className="flex flex-wrap items-center gap-3">
                <div className={cx('grid h-11 w-11 shrink-0 place-items-center rounded-full text-sm font-semibold text-white shadow-sm', avColor(u.username))}>
                  {initials(u.fullName || u.username)}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold">{u.fullName || u.username}</span>
                    {isMe && <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted">siz</span>}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted">
                    <span className="truncate">@{u.username}</span>
                    <span aria-hidden>·</span>
                    <span className="inline-flex shrink-0 items-center gap-1" title="Oxirgi kirish"><Ico.calendar size={11} /> {relLogin(u.lastLoginAt)}</span>
                  </div>
                </div>

                <span className={cx('ml-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', u.role === 'ADMIN' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-brand-500/15 text-brand-600 dark:text-brand-300')}>
                  {u.role === 'ADMIN' ? <Ico.check size={12} /> : <Ico.user size={12} />}
                  {u.role === 'ADMIN' ? 'Admin' : 'Yurist'}
                </span>
                <span className={cx('inline-flex items-center gap-1.5 text-[11px] font-medium', u.active ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted')}>
                  <span className={cx('h-1.5 w-1.5 rounded-full', u.active ? 'bg-emerald-500' : 'bg-slate-400')} />
                  {u.active ? 'Faol' : 'Bloklangan'}
                </span>

                <div className="ml-auto flex items-center gap-1">
                  {busy && <Spinner className="mr-1 h-4 w-4 border-brand-500/50" />}
                  <IconBtn title={editing ? 'Yopish' : 'Tahrirlash'} active={editing} disabled={busy} onClick={() => { setEditingId(editing ? null : u.id); setAdding(false); }}>
                    <Ico.pen size={16} />
                  </IconBtn>
                  <IconBtn
                    title={isMe && u.active ? 'O‘zingizni bloklay olmaysiz' : u.active ? 'Bloklash' : 'Faollashtirish'}
                    disabled={busy || (isMe && u.active)}
                    onClick={() => toggleActive(u)}
                  >
                    {u.active ? <Ico.lock size={16} /> : <Ico.unlock size={16} />}
                  </IconBtn>
                  <IconBtn title={isMe ? 'O‘zingizni o‘chira olmaysiz' : 'O‘chirish'} danger disabled={busy || isMe} onClick={() => remove(u)}>
                    <Ico.trash size={16} />
                  </IconBtn>
                </div>
              </div>

              {!editing && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line/60 pt-3">
                  {u.role === 'ADMIN' ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted"><Ico.check size={13} /> Barcha bosqichlar · to‘liq ruxsat</span>
                  ) : u.steps.length ? (
                    STEP_KEYS.filter((k) => u.steps.includes(k)).map((k) => (
                      <span key={k} className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-1 text-[11px] font-medium">
                        <span className="grid h-4 w-4 place-items-center rounded-full bg-brand-500/15 text-[9px] font-semibold tabular-nums text-brand-600 dark:text-brand-300">{STEP_META[k].step}</span>
                        {STEP_META[k].label}
                      </span>
                    ))
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400"><Ico.info size={13} /> Hech qanday bosqich berilmagan</span>
                  )}
                </div>
              )}

              {editing && (
                <div className="mt-3 animate-fade-in">
                  <UserForm mode="edit" initial={u} onDone={() => { setEditingId(null); refresh(); }} onCancel={() => setEditingId(null)} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
