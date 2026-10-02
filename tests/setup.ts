import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// lib/auth 在 import 时读取 NEXTAUTH_SECRET 组装 authOptions，统一注入测试密钥避免"断言恒真"；
// 长度取 32 位：NextAuth 会拒绝短于 32 位的 secret，走到 requireSession 的路由会直接 500。
process.env.NEXTAUTH_SECRET = "test-secret-0123456789abcdef0123";

// 备份 HMAC 签名密钥：生产环境强制要求配置（缺失即拒绝签名/校验），
// 测试环境统一注入固定值，保证备份导出/恢复用例可稳定运行
process.env.BACKUP_HMAC_KEY = "test-backup-hmac-key-0123456789abcdef";

// 每个测试结束后清理 DOM 与 mock：
// restoreAllMocks 恢复 vi.spyOn 的 spy；unstubAllGlobals 撤销 stubGlobal 的全局替换（如 fetch）
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// jsdom 缺少 matchMedia（部分组件/库会用到）；node 环境无 window，需保护
if (typeof window !== "undefined" && !window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// jsdom 未实现 PointerEvent（jsdom >=25 需要手动 polyfill）
if (typeof window !== "undefined" && typeof window.PointerEvent === "undefined") {
  // 基于 MouseEvent 的最小实现：保留 pointerType / button 字段
  class JsdomPointerEvent extends MouseEvent {
    readonly pointerType: string;
    readonly isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerType = init.pointerType ?? "";
      this.isPrimary = init.isPrimary ?? true;
    }
  }
  Object.defineProperty(window, "PointerEvent", {
    writable: true,
    value: JsdomPointerEvent,
  });
}
