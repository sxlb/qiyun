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
    // 默认 node 环境（逻辑/API 测试）；组件测试（.test.tsx）在文件顶部
    // 用 `// @vitest-environment jsdom` 注释声明环境
    // 注：vitest 4 移除了 environmentMatchGlobs 配置，故改用 per-file 注释
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/setup.ts"],
  },
});
