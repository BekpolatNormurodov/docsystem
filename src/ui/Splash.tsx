import React from 'react';
import { Logo } from './Logo';

/**
 * Route-level splash. Next renders this from `loading.tsx` while a server component streams,
 * so it must not depend on session or data — just the mark, the app name and a quiet bar.
 */
export function Splash({ appName }: { appName: string }) {
  return (
    <div className="grid min-h-screen place-items-center bg-bg px-6">
      <div className="flex flex-col items-center gap-4">
        <div className="animate-splash-pop">
          <Logo size={64} />
        </div>
        <div className="text-center">
          <div className="text-sm font-semibold">{appName}</div>
          <div className="mt-0.5 text-xs text-muted">Maʼlumotnoma tizimi</div>
        </div>
        <div
          className="mt-1 h-1 w-32 overflow-hidden rounded-full bg-surface-2"
          role="progressbar"
          aria-label="Yuklanmoqda"
        >
          <div className="animate-splash-bar h-full w-1/2 rounded-full bg-brand-600 dark:bg-brand-400" />
        </div>
      </div>
    </div>
  );
}
