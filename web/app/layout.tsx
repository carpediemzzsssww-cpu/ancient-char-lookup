import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "古文字对照表 · ancient char lookup",
  description:
    "粘贴汉字 → 自动生成「甲骨文 · 金文 · 战国文字 · 篆书」对照表，可打印 A4。数据来源 ccamc.org（CC0），完整 99.6% 命中请用本地 CLI。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400&family=DM+Mono:wght@300;400&family=Noto+Serif+SC:wght@400;600;700;900&family=Ma+Shan+Zheng&display=swap"
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
