'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Logo } from '@/ui';
import { Ico } from '@/ui/icons';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Login yoki parol xato');
        return;
      }
      router.push('/');
      router.refresh();
    } catch {
      setError('Serverga ulanib bo‘lmadi. Qayta urinib ko‘ring.');
    } finally {
      setLoading(false);
    }
  }

  const fieldCls =
    'w-full rounded-xl border border-line bg-surface py-2.5 pl-10 pr-3 text-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15';

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg p-4">
      {/* ambient brand glow — the one flourish, kept quiet */}
      <div aria-hidden className="pointer-events-none absolute -top-32 left-1/2 h-72 w-[38rem] -translate-x-1/2 rounded-full bg-brand-500/15 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute bottom-0 right-1/4 h-64 w-96 rounded-full bg-brand-400/10 blur-3xl" />

      <div className="relative w-full max-w-sm animate-fade-in">
        {/* brand lockup */}
        <div className="mb-6 flex flex-col items-center text-center">
          <Logo size={48} className="mb-3" />
          <div className="text-lg font-bold tracking-tight">Docsystem</div>
          <div className="text-xs text-muted">Maʼlumotnoma tizimi</div>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-6 shadow-xl shadow-slate-900/5">
          <h1 className="mb-1 text-base font-semibold">Tizimga kirish</h1>
          <p className="mb-5 text-xs text-muted">Login va parolingizni kiriting</p>

          <form onSubmit={onSubmit} className="space-y-3.5">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted" htmlFor="username">Login</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"><Ico.user size={17} /></span>
                <input
                  id="username"
                  className={fieldCls}
                  type="text"
                  autoComplete="username"
                  placeholder="login"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoFocus
                  required
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted" htmlFor="password">Parol</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"><Ico.lock size={17} /></span>
                <input
                  id="password"
                  className={`${fieldCls} pr-10`}
                  type={showPw ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? 'Yashirish' : 'Ko‘rsatish'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-muted transition-colors hover:text-fg"
                >
                  {showPw ? <Ico.eyeOff size={17} /> : <Ico.eye size={17} />}
                </button>
              </div>
            </div>

            {error && (
              <div role="alert" className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs font-medium text-rose-500">
                <Ico.info size={15} /> {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:opacity-60"
            >
              {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-transparent" />}
              {loading ? 'Kirilmoqda…' : 'Kirish'}
            </button>
          </form>
        </div>

        <p className="mt-5 text-center text-[11px] text-muted">© Docsystem · Maʼlumotnoma boshqaruv tizimi</p>
      </div>
    </div>
  );
}
