import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "プログラムテスト | ローカルランナー",
  description:
    "program-ec-frontend 向けローカルプログラム実行オリジン（Next.js）",
  formatDetection: {
    telephone: false,
    email: false,
    address: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
