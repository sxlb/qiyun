import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * 社交链接区的「可见性契约」。
 *
 * 背景：胶囊原本静止态完全透明（连 background-color 都没声明），只有 :hover 才浮现毛玻璃底 ——
 * 32px 图标与 11px 小字直接浮在壁纸上，浅色或花哨壁纸下几乎看不见；
 * 触屏更是连悬停都没有，等于永远没有底色。
 *
 * 现在改成「容器出面板、胶囊保持轻盈」：由 .social-links-bar 这块玻璃面板提供底色与阴影
 * （与简介卡片同一档阴影 token），胶囊静止态不再自带底色 —— 否则两层玻璃叠起来会发灰发脏。
 * 这里把 globals.css 读出来，把这两件事同时钉死：面板必须有底，胶囊必须不带底。
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

describe("社交链接面板：容器出底、胶囊轻盈", () => {
  it("面板静止态就有底色，不是 transparent", () => {
    const body = ruleBody(".social-links-bar");
    expect(body).toMatch(/background-color:\s*rgba\(/);
    expect(body).not.toMatch(/background-color:\s*transparent/);
  });

  it("面板阴影复用卡片那一档 token，而不是就地写死 px", () => {
    expect(ruleBody(".social-links-bar")).toMatch(/box-shadow:\s*var\(--(card-)?shadow-/);
  });

  it("面板带毛玻璃，且写了 -webkit- 前缀（Safari 也要生效）", () => {
    const body = ruleBody(".social-links-bar");
    expect(body).toMatch(/backdrop-filter:\s*blur\(/);
    expect(body).toMatch(/-webkit-backdrop-filter:\s*blur\(/);
  });

  it("面板底色与模糊跟随后台「玻璃不透明度 / 模糊」滑杆，与主卡片同一套变量", () => {
    const body = ruleBody(".social-links-bar");
    expect(body).toMatch(/var\(--card-alpha/);
    expect(body).toMatch(/var\(--glass-blur/);
  });

  it("胶囊静止态不带底色、不带阴影（避免与面板叠成双层玻璃）", () => {
    const body = ruleBody(".social-icon");
    expect(body).not.toMatch(/background-color:/);
    expect(body).not.toMatch(/box-shadow:/);
    expect(body).not.toMatch(/backdrop-filter:/);
  });

  it("胶囊悬停与按压仍有填充反馈", () => {
    expect(ruleBody(".social-icon:hover")).toMatch(/background-color:\s*rgba\(/);
    expect(ruleBody(".social-icon:active")).toMatch(/background-color:\s*rgba\(/);
  });

  it("图标下方的文字标题带 text-shadow，保证壁纸亮区可读", () => {
    expect(ruleBody(".social-link-title")).toMatch(/text-shadow:\s*0\s+1px/);
  });
});
