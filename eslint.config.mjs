// ESLint flat config（Next.js 官方迁移方案）
import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  // 忽略构建产物与自动生成文件、参考站源码副本（.ref-home 仅作设计参照，不参与检查）
  {
    ignores: [".next/**", "next-env.d.ts", "tsconfig.tsbuildinfo", ".ref-home/**"],
  },
  // Next.js 核心规则（含 React/TS 规则，对应 next lint 的 Strict 模式）
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  // seed.js 是 Docker 直接运行的 CommonJS 脚本；tailwind.config.ts 使用官方推荐的 require 写法
  {
    files: ["prisma/seed.js", "tailwind.config.ts"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // 单元测试常需以 any 模拟第三方/重载函数（如 dns.lookup）的返回，仅对测试目录豁免，生产代码仍旧严格
  {
    files: ["tests/**/*.ts", "tests/**/*.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];

export default eslintConfig;
