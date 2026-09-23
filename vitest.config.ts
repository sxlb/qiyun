import { defineConfig } from "vitest/config";
import path from "node:path";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
  test: {
    // 默认 node 环境（逻辑/API 测试）；.test.tsx 组件测试按扩展名路由到 jsdom，
    // 不再依赖文件顶部 @vitest-environment 注释（显式标注的注释仍优先生效，双保险）
    environment: "node",
    environmentMatchGlobs: [["tests/**/*.test.tsx", "jsdom"]],
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/setup.ts"],
  },
});
