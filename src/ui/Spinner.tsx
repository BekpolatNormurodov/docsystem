/**
 * Inline busy indicator, sized to sit next to button text.
 *
 * Not exempted from reduced-motion: this is system status, not decoration — a frozen spinner
 * would say "stuck" when the truth is "working". The button's label carries the same meaning for
 * anyone who cannot see it.
 */
export function Spinner({ size = 18, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={`animate-spin ${className}`}
      aria-hidden
      focusable="false"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
