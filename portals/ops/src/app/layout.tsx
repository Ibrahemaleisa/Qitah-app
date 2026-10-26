import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans_Arabic } from 'next/font/google';

import './globals.css';

// Self-hosted at build time by next/font. If the font cannot be loaded, the system stack below is used.
const plex = IBM_Plex_Sans_Arabic({
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-plex',
  fallback: ['system-ui', '-apple-system', 'Segoe UI', 'Tahoma', 'Arial', 'sans-serif'],
});

export const metadata: Metadata = {
  title: { default: 'قطعة — بوابة العمليات', template: '%s · بوابة العمليات' },
  description: 'بوابة العمليات الداخلية وبرج التحكم بالشحن — قطعة',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: '#022B74', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="ar" dir="rtl" className={plex.variable}>
      <body>{children}</body>
    </html>
  );
}
