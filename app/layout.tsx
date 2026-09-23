import type { Metadata } from "next";
import "./globals.css";
import localFont from "next/font/local";

import { Toaster } from "@/components/ui/sonner";

// 全站字体：中文思源黑体 + 西文 Inter 兜底
const notoSc = localFont({ src: [{ path: "../public/fonts/google-local/font-noto-sc.woff2", weight: "400", style: "normal" }], variable: "--font-noto-sc", display: "swap" });
const inter = localFont({ src: [{ path: "../public/fonts/google-local/font-inter.woff2", weight: "400", style: "normal" }], variable: "--font-inter", display: "swap" });
const techMono = localFont({ src: [{ path: "../public/fonts/google-local/font-tech-mono.woff2", weight: "400", style: "normal" }], variable: "--font-tech-mono", display: "swap", preload: false });

// ===== 昵称内置艺术字体：有爱圆体(中文) + Baloo 2(西文)，中英双语 =====
const nowarRounded = localFont({
  src: [
    { path: "../public/fonts/nowar-rounded/NowarRounded-Regular.woff2", weight: "400", style: "normal" },
    { path: "../public/fonts/nowar-rounded/NowarRounded-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-nowar",
  display: "swap",
  preload: false,
});
const baloo2 = localFont({ src: [{ path: "../public/fonts/nowar-rounded/Baloo2-Variable.woff2", weight: "400", style: "normal" }], variable: "--font-baloo", display: "swap", preload: false });

export const metadata: Metadata = {
  title: "个人主页",
  description: "极简个人主页",
  applicationName: "栖云 · Qiyun",
  creator: "Qiyun",
  robots: { index: true, follow: true },
  formatDetection: { email: false, address: false, telephone: false },
  // 具体 OpenGraph / Twitter 卡片由各页面（首页 generateMetadata）基于后台配置填充
  openGraph: {
    type: "website",
    locale: "zh_CN",
    siteName: "栖云 · Qiyun",
    title: "个人主页",
    description: "极简个人主页",
  },
  twitter: { card: "summary_large_image", title: "个人主页", description: "极简个人主页" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* 内置字体：思源黑体（正文）+ Inter（西文）+ Tech Mono（时钟）+ 有爱圆体/Baloo2（昵称艺术字体，中英双语） */}
      </head>
      <body
        className={`${notoSc.variable} ${inter.variable} ${techMono.variable} ${baloo2.variable} ${nowarRounded.variable}`}
        style={{ fontFamily: "var(--font-noto-sc), var(--font-inter), system-ui, sans-serif" }}
      >
        {/* 主页不依赖 session，SessionProvider 仅在 /admin 布局中使用，避免多余请求 */}
        {children}
        <Toaster />
      </body>
    </html>
  );
}
