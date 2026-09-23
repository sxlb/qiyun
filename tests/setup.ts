import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// 登录相关模块（lib/auth）在 import 时读取 NEXTAUTH_SECRET 组装 authOptions，
// 统一设置测试密钥，避免"断言恒真"或"secret 缺失"类问题
process.env.NEXTAUTH_SECRET = "test-secret-0123456789abcdef";

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
