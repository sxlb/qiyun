import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { DEFAULT_LYRIC_SIZE, LYRIC_SIZE_OPTIONS, parseLyricSize } from "@/components/musicPanelThemes";

/**
 * 顶部悬浮歌词的字号是「TS 常量表 + CSS 档位规则」两边配合的：
 * 组件只渲染 data-size，真正的像素值写在 app/globals.css 里（移动端 / 桌面端各一套）。
 * 两边一旦脱节（比如常量加了档但 CSS 忘了写，或只写了一套值），界面会静默回落默认字号。
 * 这里把 CSS 读出来对齐，把这类回归钉死在测试里。
 */
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

/** 取某一档在 CSS 里的所有 --tl-size 值：基础规则（移动端）+ 媒体查询（桌面端）各一个 */
function sizesFor(level: number): number[] {
  const re = new RegExp(`\\.top-lyric\\[data-size="${level}"\\]\\s*\\{\\s*--tl-size:\\s*(\\d+)px`, "g");
  return [...css.matchAll(re)].map((match) => Number(match[1]));
}

describe("顶部悬浮歌词字号：CSS 档位与常量表一致", () => {
  it("胶囊字号取自 CSS 变量，而不是写死的 px", () => {
    expect(css).toMatch(/\.top-lyric\s*\{[^}]*font-size:\s*var\(--tl-size/);
  });

  it("CSS 里的档位与常量表完全相同（不多不少）", () => {
    const defined = [...css.matchAll(/\.top-lyric\[data-size="(\d+)"\]/g)].map((m) => Number(m[1]));
    expect([...new Set(defined)].sort((a, b) => a - b)).toEqual(LYRIC_SIZE_OPTIONS.map((o) => o.value));
  });

  it("每档都给了「移动端 + 桌面端」两个值", () => {
    for (const { value } of LYRIC_SIZE_OPTIONS) {
      expect(sizesFor(value)).toHaveLength(2);
    }
  });

  it("桌面端一律大于移动端（解决「PC 偏小、移动端偏大」）", () => {
    for (const { value } of LYRIC_SIZE_OPTIONS) {
      const [mobile, desktop] = sizesFor(value);
      expect(desktop).toBeGreaterThan(mobile);
    }
  });

  it("两套值都随档位单调递增，不会忽大忽小", () => {
    const mobile = LYRIC_SIZE_OPTIONS.map((o) => sizesFor(o.value)[0]);
    const desktop = LYRIC_SIZE_OPTIONS.map((o) => sizesFor(o.value)[1]);
    for (let i = 1; i < LYRIC_SIZE_OPTIONS.length; i += 1) {
      expect(mobile[i]).toBeGreaterThan(mobile[i - 1]);
      expect(desktop[i]).toBeGreaterThan(desktop[i - 1]);
    }
  });

  it("默认档位与落盘约定一致（数字字符串）", () => {
    expect(String(DEFAULT_LYRIC_SIZE)).toBe("4");
    expect(parseLyricSize(String(DEFAULT_LYRIC_SIZE))).toBe(DEFAULT_LYRIC_SIZE);
  });
});
