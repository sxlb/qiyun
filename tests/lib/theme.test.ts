// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { THEME_MODES, isThemeMode, resolveDark, themeInitScript, type BgTheme, type ThemeMode } from "@/lib/theme";

/** 用给定系统偏好替换 window.matchMedia（tests/setup.ts 已将其定义为 writable） */
function stubMatchMedia(prefersDark: boolean) {
  (window as unknown as { matchMedia: (q: string) => unknown }).matchMedia = (query: string) => ({
    matches: query.indexOf("dark") !== -1 ? prefersDark : false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

/**
 * 在受控环境下真实执行首帧脚本，返回它写下的深色判定。
 * 这是「脚本 ↔ resolveDark 不漂移」的硬约束：改任一侧而忘记另一侧，此测试立刻失败。
 */
function runInitScript(mode: ThemeMode, prefersDark: boolean, hour: number): { dark: boolean; colorScheme: string } {
  stubMatchMedia(prefersDark);
  const base = new Date(2026, 0, 1, hour, 0, 0);
  vi.setSystemTime(base);

  document.documentElement.className = "";
  document.documentElement.style.colorScheme = "";

  // 脚本文本是自包含 IIFE，直接求值即可
  new Function(themeInitScript(mode))();

  return {
    dark: document.documentElement.classList.contains("dark"),
    colorScheme: document.documentElement.style.colorScheme,
  };
}

describe("resolveDark", () => {
  it("light / dark 为固定值，不受其他信号影响", () => {
    for (const hour of [0, 12, 23]) {
      for (const prefersDark of [false, true]) {
        expect(resolveDark("light", { prefersDark, hour, bgTheme: "dark" })).toBe(false);
        expect(resolveDark("dark", { prefersDark, hour, bgTheme: "light" })).toBe(true);
      }
    }
  });

  it("time 模式：6:00-18:00 浅色，其余深色", () => {
    const at = (hour: number) => resolveDark("time", { prefersDark: false, hour, bgTheme: null });
    expect(at(5)).toBe(true);
    expect(at(6)).toBe(false);
    expect(at(12)).toBe(false);
    expect(at(17)).toBe(false);
    expect(at(18)).toBe(true);
    expect(at(23)).toBe(true);
    expect(at(0)).toBe(true);
  });

  it("bg 模式：取色完成前回落系统偏好，取色完成后以壁纸明暗为准", () => {
    expect(resolveDark("bg", { prefersDark: true, hour: 12, bgTheme: null })).toBe(true);
    expect(resolveDark("bg", { prefersDark: false, hour: 12, bgTheme: null })).toBe(false);
    expect(resolveDark("bg", { prefersDark: false, hour: 12, bgTheme: "dark" })).toBe(true);
    expect(resolveDark("bg", { prefersDark: true, hour: 12, bgTheme: "light" })).toBe(false);
  });

  it("system 模式直接跟随系统偏好", () => {
    expect(resolveDark("system", { prefersDark: true, hour: 12, bgTheme: null })).toBe(true);
    expect(resolveDark("system", { prefersDark: false, hour: 12, bgTheme: null })).toBe(false);
  });
});

describe("themeInitScript", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.documentElement.className = "";
    document.documentElement.style.colorScheme = "";
  });

  it("产出可执行的自包含 IIFE，并带上目标模式", () => {
    const script = themeInitScript("time");
    expect(script.startsWith("(function(){")).toBe(true);
    expect(script.endsWith("})();")).toBe(true);
    expect(script).toContain('"time"');
    // 不依赖任何模块作用域标识符（压缩后仍可执行）
    expect(script).not.toContain("import");
    expect(script).not.toContain("require(");
  });

  it("执行结果与 resolveDark 在全部模式 × 系统偏好 × 小时组合下完全一致（bgTheme 未知契约）", () => {
    const hours = [0, 5, 6, 12, 17, 18, 23];
    const bgThemes: BgTheme[] = [null];

    for (const mode of THEME_MODES) {
      for (const prefersDark of [false, true]) {
        for (const hour of hours) {
          for (const bgTheme of bgThemes) {
            const actual = runInitScript(mode, prefersDark, hour);
            const expected = resolveDark(mode, { prefersDark, hour, bgTheme });
            expect(
              actual.dark,
              `mode=${mode} prefersDark=${prefersDark} hour=${hour} bgTheme=${bgTheme}`
            ).toBe(expected);
          }
        }
      }
    }
  });

  it("同步写入 color-scheme，保证原生控件与滚动条跟随主题", () => {
    expect(runInitScript("dark", false, 12).colorScheme).toBe("dark");
    expect(runInitScript("light", true, 12).colorScheme).toBe("light");
    expect(runInitScript("system", true, 12).colorScheme).toBe("dark");
    expect(runInitScript("system", false, 12).colorScheme).toBe("light");
  });

  it("宿主环境缺少 matchMedia 时不抛错，回落浅色", () => {
    (window as unknown as { matchMedia: unknown }).matchMedia = undefined;
    document.documentElement.className = "";
    expect(() => new Function(themeInitScript("system"))()).not.toThrow();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});

describe("isThemeMode", () => {
  it("仅接受白名单取值", () => {
    for (const mode of THEME_MODES) expect(isThemeMode(mode)).toBe(true);
    expect(isThemeMode("Dark")).toBe(false);
    expect(isThemeMode("auto")).toBe(false);
    expect(isThemeMode(null)).toBe(false);
    expect(isThemeMode(1)).toBe(false);
    expect(isThemeMode(undefined)).toBe(false);
  });
});
