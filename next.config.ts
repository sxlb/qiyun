import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // 图标库按需打包，减少首屏 JS 体积
    optimizePackageImports: ["lucide-react"],
  },
  // 全站安全响应头：缓解 XSS / 点击劫持 / MIME 嗅探等风险
  async headers() {
    const isDev = process.env.NODE_ENV === "development";
    const csp = [
      "default-src 'self'",
      // 生产构建使用 next/font 自托管字体，无外部脚本；dev 模式 HMR 需要 eval 与 ws
      // at.alicdn.com：阿里云矢量图标库（iconfont）官方托管域名，供社交/网站链接图标 symbol 脚本
      `script-src 'self' 'unsafe-inline' https://at.alicdn.com${isDev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      // 壁纸/头像/封面等可能来自任意 https/http 图床
      "img-src 'self' data: blob: https: http:",
      "font-src 'self' data:",
      // dev HMR 使用 ws://localhost
      `connect-src 'self' https: http: ws: wss:`,
      "media-src 'self' https: http: blob:",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ");

    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          { key: "Content-Security-Policy", value: csp },
        ],
      },
    ];
  },
};

export default nextConfig;
