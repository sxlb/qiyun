import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * 社交链接胶囊的「可见性契约」。
 *
 * 背景：胶囊原本静止态完全透明，只有悬停才浮现毛玻璃底 —— 32px 图标与 11px 小字
 * 直接浮在壁纸上，浅色或花哨壁纸下几乎看不见，触屏更是连悬停都没有（等于永远没底色）。
 * 现在改成常驻玻璃底 + 阴影，并复用简介卡片那一档阴影 token。
 * 这里把 globals.css 读出来，把「不能再退回透明」钉死。
 */
const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8").replace(
  // 去注释，避免注释里的措辞干扰断言
  /\/\*[\s\S]*?\*\//g,
  ""
);

/** 取某个选择器的声明块（精确匹配，不会命中 .social-icon:hover） */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`未在 globals.css 中找到 ${selector} 规则`);
  return match[1];
}

describe("社交链接胶囊：常驻底色与阴影", () => {
  it("静止态就有底色，不是 transparent", () => {
    const body = ruleBody(".social-icon");
    expect(body).toMatch(/background-color:\s*rgba\(/);
    expect(body).not.toMatch(/background-color:\s*transparent/);
  });

  it("底色跟随后台「玻璃不透明度」滑杆，与主卡片同一套变量", () => {
    expect(ruleBody(".social-icon")).toMatch(/--social-alpha:\s*calc\(var\(--card-alpha/);
  });

  it("阴影复用卡片那一档 token，而不是就地写死 px", () => {
    expect(ruleBody(".social-icon")).toMatch(/box-shadow:\s*var\(--(card-)?shadow-/);
  });

  it("带毛玻璃，且写了 -webkit- 前缀（Safari 也要生效）", () => {
    const body = ruleBody(".social-icon");
    expect(body).toMatch(/backdrop-filter:\s*blur\(/);
    expect(body).toMatch(/-webkit-backdrop-filter:\s*blur\(/);
  });

  it("悬停与按压态都有阴影反馈", () => {
    expect(ruleBody(".social-icon:hover")).toMatch(/box-shadow:\s*var\(--(card-)?shadow-/);
    expect(ruleBody(".social-icon:active")).toMatch(/box-shadow:\s*var\(--(card-)?shadow-/);
  });

  it("图标下方的文字标题带 text-shadow，保证壁纸亮区可读", () => {
    expect(ruleBody(".social-link-title")).toMatch(/text-shadow:\s*0\s+1px/);
  });
});
