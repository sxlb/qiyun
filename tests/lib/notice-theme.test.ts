import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * 站点通知弹窗（欢迎 / 公告）的「配色同源契约」。
 *
 * 背景：弹窗原先写死一套海军蓝渐变（#1b2440 / #161d33 / #101627）+ 白色描边，
 * 既不在站点调色板里，也完全不吃后台的三个视觉滑杆（强调色 / 玻璃不透明度 / 模糊强度），
 * 用户把强调色调成暖橙，弹窗依旧一片深蓝 —— 看起来像从别的站搬来的一块浮层。
 *
 * 现在改成与站内卡片同源：底色 = 纯黑 + var(--card-alpha)、模糊 = var(--glass-blur)、
 * 强调 = var(--accent-color)、圆角投影 = var(--radius-*) / var(--shadow-*)。
 * 这里把 globals.css 与组件源码一起读出来，把「必须吃令牌」和「不得再写死色值」两边同时钉死。
 */
const ROOT = new URL("../../", import.meta.url);
const rawCss = readFileSync(new URL("app/globals.css", ROOT), "utf8");
const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, ""); // 去注释，避免注释里的措辞干扰断言
const component = readFileSync(
  new URL("components/home/AnnouncementNotification.tsx", ROOT),
  "utf8"
);

/** 取某个选择器的声明块（精确匹配，不会命中 .notice-card:hover） */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`未在 globals.css 中找到 ${selector} 规则`);
  return match[1];
}

describe("通知弹窗：玻璃质感吃站内令牌", () => {
  it("底色由 --card-alpha 推导，而不是写死的不透明色", () => {
    const body = ruleBody(".notice-card");
    expect(body).toMatch(/background-color:\s*rgba\(\s*0,\s*0,\s*0,\s*calc\(var\(--card-alpha/);
  });

  it("模糊强度由 --glass-blur 推导，且带 -webkit- 前缀（Safari 也要生效）", () => {
    const body = ruleBody(".notice-card");
    expect(body).toMatch(/backdrop-filter:\s*blur\(calc\(var\(--glass-blur/);
    expect(body).toMatch(/-webkit-backdrop-filter:\s*blur\(calc\(var\(--glass-blur/);
  });

  it("圆角与投影复用站内令牌，而不是就地写死 px", () => {
    const body = ruleBody(".notice-card");
    expect(body).toMatch(/border-radius:\s*var\(--radius-/);
    expect(body).toMatch(/box-shadow:\s*var\(--shadow-/);
  });

  it("强调色只认 --accent-color，改后台强调色弹窗跟着变", () => {
    // 发丝线 / 头部图标 / 公告左侧竖条 / 主按钮，四处都要同源
    for (const selector of [
      ".notice-hairline",
      ".notice-head-icon",
      ".notice-item::before",
      ".notice-primary",
    ]) {
      expect(ruleBody(selector), `${selector} 未使用 --accent-color`).toMatch(/var\(--accent-color/);
    }
    // 焦点环是多选择器，单独取一次
    expect(css).toMatch(
      /\.notice-primary:focus-visible\s*\{\s*outline:\s*2px solid color-mix\(in srgb, var\(--accent-color/
    );
  });

  it("系统开启「减弱动态效果」时不做位移缩放", () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.animate-notice-center\s*\{[^}]*animation:\s*fade/
    );
  });
});

describe("通知弹窗：不得回退到写死配色", () => {
  it("旧的海军蓝渐变已从 globals.css 与组件里彻底清除", () => {
    for (const hex of ["#1b2440", "#161d33", "#101627"]) {
      expect(rawCss.toLowerCase()).not.toContain(hex);
      expect(component.toLowerCase()).not.toContain(hex);
    }
  });

  it("组件外观全部走 .notice-* 组件类，不再内联写死颜色", () => {
    expect(component).toContain("notice-card");
    expect(component).toContain("notice-primary");
    // 内联 style 是「颜色绕过令牌体系」最常见的入口：发现新加的内联样式即失败
    expect(component).not.toMatch(/style=\{\{/);
  });

  it("欢迎语不再自带图标块（真实渲染里它与头部图标是同款同色方块，看起来像两个列表项）", () => {
    expect(css).not.toContain(".notice-welcome-icon");
    expect(component).not.toContain("notice-welcome-icon");
  });

  it("弹窗语义与主操作文案保持稳定（测试与无障碍都依赖它）", () => {
    expect(component).toMatch(/role="dialog"/);
    expect(component).toContain("我知道了");
  });
});
