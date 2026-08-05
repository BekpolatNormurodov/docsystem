import React from 'react';

/**
 * The product mark: a signed maʼlumotnoma — a sheet with a seal check.
 *
 * One mark for every app (yurist / admin / rahbar / public) so the sidebar, the splash and
 * the browser tab all read as the same product. Kept to two shapes on a solid tile because
 * it also has to survive being drawn at 16px in a tab strip; the per-app colour that used to
 * distinguish the panels lives in the role label instead.
 *
 * The favicons in each app's `src/app/icon.svg` are the same geometry — edit both together.
 */
export function Logo({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      role="img"
      aria-label="Maʼlumotnoma"
    >
      <defs>
        <linearGradient id="spravka-mark" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3B82F6" />
          <stop offset="1" stopColor="#1D4ED8" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#spravka-mark)" />
      {/* Sheet with a folded corner */}
      <path
        d="M11 7.5h6.2L22 12.3V22a2.5 2.5 0 0 1-2.5 2.5h-8.5A2.5 2.5 0 0 1 8.5 22V10A2.5 2.5 0 0 1 11 7.5Z"
        fill="#fff"
      />
      <path d="M17.2 7.5 22 12.3h-4.8V7.5Z" fill="#BFDBFE" />
      {/* Seal check */}
      <path
        d="m11.8 17.4 2.6 2.6 5.2-5.4"
        stroke="#059669"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Mark + name, as used in the sidebar header and on the splash. */
export function LogoLockup({ appName, className }: { appName: string; className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className ?? ''}`}>
      <Logo size={36} className="shrink-0" />
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold leading-tight">{appName}</div>
        <div className="text-xs text-muted">Maʼlumotnoma</div>
      </div>
    </div>
  );
}
