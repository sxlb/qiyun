import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // 允许 127.0.0.1 访问 dev 服务器：否则 Next 16 跨域保护会阻断 /_next/hmr 等
  // dev 资源，页面水合失败（时钟卡 "--:--"、一言/天气不加载、点击无响应）
  allowedDevOrigins: ["127.0.0.1"],
  experimental: {
    // 图标库按需打包，减少首屏 JS 体积
    optimizePackageImports: ["lucide-react"],
  },
  // 全站安全响应头：缓解 XSS / 点击劫持 / MIME 嗅探等风险
  async headers() {
    const isDev = process.env.NODE_ENV === "development";
    const csp = [
      "default-src 'self'",
      // script-src：除本站与 iconfont 外，必须放行 'unsafe-inline' ——
      // Next.js 的 RSC 载荷以内联 <script>self.__next_f.push(...)</script> 下发，
      // 严格 script-src 必须配套 nonce 基础设施（middleware 注入 x-nonce 并动态改写
      // CSP 头）。本项目未启用 nonce，若不放开 'unsafe-inline'，内联载荷被拦截后
      // Flight 流为空 → 白屏 + "Minified React error #412 (Connection closed)"。
      // 注入风险面：页面仅有的内联脚本来自 Next 自身；后台自定义脚本走 src 直链，
      // 不引入内联执行。若未来启用 nonce，可移除 'unsafe-inline' 恢复严格策略。
      `script-src 'self' https://at.alicdn.com 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      // 壁纸/头像/封面等可能来自任意 https/http 图床
      "img-src 'self' data: blob: https: http:",
      "font-src 'self' data:",
      // 出站目标：本站 + 多方上游 API（天气/一言/壁纸/图标等地址均可由后台配置），
      // 无法收敛为固定域名白名单；ws:/wss: 仅 dev 模式 HMR 需要，生产下不放开
      `connect-src 'self' https: http:${isDev ? " ws: wss:" : ""}`,
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
