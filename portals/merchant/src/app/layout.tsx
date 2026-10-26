import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic } from "next/font/google";

import { ToastProvider } from "@/components/ui/Toast";

import "./globals.css";

const plex = IBM_Plex_Sans_Arabic({
  variable: "--font-plex",
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  fallback: ["Segoe UI", "Tahoma", "system-ui", "sans-serif"],
});

export const metadata: Metadata = {
  title: { default: "بوابة التجار | قطعة", template: "%s | بوابة تجار قطعة" },
  description: "بوابة تجار قطعة لإدارة الطلبات والمخزون والعروض",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#022B74", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ar" dir="rtl" className={`${plex.variable} h-full antialiased`}>
      <body className="min-h-full">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
