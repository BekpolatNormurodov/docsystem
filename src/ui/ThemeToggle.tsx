'use client';

import { useEffect, useState } from 'react';
import { Ico } from './icons';

/** Light/dark switch. Persists to localStorage; the ThemeScript applies it before paint. */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  function toggle() {
    const next = !dark;
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('spravka.theme', next ? 'dark' : 'light');
    } catch {}
    setDark(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={dark ? 'Yorugʻ rejim' : 'Qorongʻi rejim'}
      aria-label={dark ? 'Yorugʻ rejimga oʻtish' : 'Qorongʻi rejimga oʻtish'}
      className={`cursor-pointer rounded-lg p-2 text-muted transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 ${className}`}
    >
      {dark ? <Ico.sun /> : <Ico.moon />}
    </button>
  );
}
