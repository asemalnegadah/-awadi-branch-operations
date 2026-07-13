import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "نظام تشغيل ورقابة فرع العوادي – عدن",
  description: "منصة تشغيل ورقابة فرع العوادي في عدن",
};

interface RootLayoutProps {
  readonly children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
