import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Professional blue (ui-ux-pro-max: Data-Dense Dashboard)
        brand: {
          50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe', 300: '#93c5fd', 400: '#60a5fa',
          500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8', 800: '#1e40af', 900: '#1e3a8a',
        },
        // Deal green (accent / signed)
        accent: {
          50: '#ecfdf5', 100: '#d1fae5', 200: '#a7f3d0', 300: '#6ee7b7', 400: '#34d399',
          500: '#10b981', 600: '#059669', 700: '#047857', 800: '#065f46', 900: '#064e3b',
        },
        // Semantic tokens (swap per theme via CSS vars)
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        fg: 'var(--fg)',
        muted: 'var(--muted)',
        line: 'var(--line)',
      },
      fontFamily: { sans: ['Plus Jakarta Sans', 'Inter', 'system-ui', 'sans-serif'] },
      boxShadow: { glow: '0 8px 30px -10px rgba(37, 99, 235, 0.45)' },
      keyframes: {
        'splash-pop': { '0%': { opacity: '0', transform: 'scale(.9)' }, '100%': { opacity: '1', transform: 'scale(1)' } },
        'splash-bar': { '0%': { transform: 'translateX(-100%)' }, '100%': { transform: 'translateX(200%)' } },
        'fade-in': { '0%': { opacity: '0', transform: 'translateY(6px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
      },
      // 'fade-in' uses `backwards`, not `both`: AppShell wraps every page in it, and `both`
      // holds the keyframe's transform forever after the animation ends. A lingering transform
      // makes that wrapper the containing block for `position: fixed`, so modals centred on the
      // content column instead of the screen and the dim stopped at the sidebar. `backwards`
      // still prevents the pre-animation flash, then reverts to transform: none.
      animation: { 'fade-in': 'fade-in .35s ease-out backwards', 'splash-pop': 'splash-pop .4s ease-out both', 'splash-bar': 'splash-bar 1.1s ease-in-out infinite' },
    },
  },
  plugins: [],
} satisfies Config;
