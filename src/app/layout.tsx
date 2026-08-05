import './globals.css';
import { ThemeScript } from '@/ui';

export const metadata = { title: 'Docsystem' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uz" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body>{children}</body>
    </html>
  );
}
