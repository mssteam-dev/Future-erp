import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "النظام المحاسبي",
  description: "برنامج محاسبي وإداري متكامل للشركة الأم والفروع",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
