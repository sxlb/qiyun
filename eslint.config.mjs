// ESLint flat config（Next.js 16 官方配置已原生为 flat 数组，无需 FlatCompat 桥接）
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  // 忽略构建产物与自动生成文件、参考站源码副本（.ref-home 仅作设计参照，不参与检查）
  {
    ignores: [".next/**", "next-env.d.ts", "tsconfig.tsbuildinfo", ".ref-home/**"],
  },
  // Next.js 核心规则（含 React/TS 规则，对应 next lint 的 Strict 模式）
  ...nextCoreWebVitals,
  ...nextTypescript,
  // React Compiler 规则：本项目未启用 React Compiler，这些增量规则会把既有合法模式
  // （render 期同步 latest-ref、effect 初始化 setState、DOM 属性写入、动态图标组件解析等）
  // 全部误报为 error。显式关闭，保留核心规则（rules-of-hooks / exhaustive-deps）。
  {
    rules: {
      "react-hooks/config": "off",
      "react-hooks/error-boundaries": "off",
      "react-hooks/gating": "off",
      "react-hooks/globals": "off",
      "react-hooks/immutability": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/set-state-in-render": "off",
      "react-hooks/static-components": "off",
      "react-hooks/unsupported-syntax": "off",
      "react-hooks/use-memo": "off",
      "react-hooks/incompatible-library": "off",
    },
  },
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
