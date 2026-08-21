import './globals.css';
import { cookies } from 'next/headers';
import { ThemeScript } from '@/ui';

export const metadata = { title: 'Maʼlumotnoma' };

// Map the `lang` cookie (set by the header LanguageSwitcher) to a valid BCP-47 html lang.
const HTML_LANG: Record<string, string> = { uz: 'uz', 'uz-cyrl': 'uz-Cyrl', ru: 'ru' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = cookies().get('lang')?.value ?? 'uz';
  return (
    <html lang={HTML_LANG[lang] ?? 'uz'} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body>{children}</body>
    </html>
  );
}
