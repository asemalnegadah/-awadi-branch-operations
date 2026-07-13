import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "نظام تشغيل ورقابة فرع العوادي – عدن",
    template: "%s | فرع العوادي – عدن",
  },
  description: "نظام داخلي لتشغيل ورقابة فرع العوادي في عدن.",
  applicationName: "نظام فرع العوادي – عدن",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#101828",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
