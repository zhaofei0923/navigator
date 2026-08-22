import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Navigator 新能源企业出海导航仪",
  description: "仅供内部展示的合成数据决策导航 demo",
  robots: { index: false, follow: false, nocache: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
