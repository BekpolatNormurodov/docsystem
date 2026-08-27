import React from 'react';

/**
 * The product mark: scales of justice — a lawyer/legal system mark for «Yurist Tizimi».
 *
 * One mark for every surface (sidebar, splash, browser tab) so the whole product reads the same.
 * Kept to simple bold shapes on a solid tile because it also has to survive being drawn at 16px in a
 * tab strip. The favicon in `src/app/icon.svg` is the same geometry — edit both together.
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
      aria-label="Yurist Tizimi"
    >
      <defs>
        <linearGradient id="yt-mark" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3B82F6" />
          <stop offset="1" stopColor="#1D4ED8" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#yt-mark)" />
      {/* Adolat tarozisi: ustun + ko'ndalang + ikki tovoq (zanjirli) + poydevor */}
      <g fill="#fff">
        <circle cx="16" cy="7" r="1.5" />
        <rect x="15.2" y="8" width="1.6" height="15" rx="0.8" />
        <rect x="9" y="9.8" width="14" height="1.5" rx="0.75" />
        <rect x="11.5" y="22.6" width="9" height="1.7" rx="0.85" />
      </g>
      <g stroke="#fff" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9.8 11 L7 15.4M9.8 11 L12.6 15.4" />
        <path d="M22.2 11 L19.4 15.4M22.2 11 L25 15.4" />
        <path d="M6.6 15.4a3 3 0 0 0 6.4 0" />
        <path d="M19 15.4a3 3 0 0 0 6.4 0" />
      </g>
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
        <div className="text-xs text-muted">boshqaruv tizimi</div>
      </div>
    </div>
  );
}
