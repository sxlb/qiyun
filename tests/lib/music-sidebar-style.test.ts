import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * 音乐侧栏的「不占布局 + 不越层」契约。
 *
 * 背景：音乐控制原本内嵌在右栏功能卡的一格里（与一言互换）。内容容器是
 * max-w-6xl(1152px) + md:px-6，视口 1280px 时左右各只剩 64px、1024px 时只剩 24px ——
 * 任何常驻竖栏都会压住时钟卡 / 导航卡。所以侧栏必须满足：
 * 1. 收起态只占一颗小圆钮（不占布局、不遮挡内容）；
 * 2. 浮层用 fixed：<main> 是 h-dvh 的滚动容器，只有 fixed 才不被它裁掉、也不计入 scrollHeight；
 * 3. 层级低于公告弹窗与音乐列表弹窗，弹窗打开时被遮罩盖住而不是压在上面；
 * 4. 玻璃质感读站内令牌，不自己写死一套配色。
 */
const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8").replace(
  // 去注释，避免注释里的措辞干扰断言
  /\/\*[\s\S]*?\*\//g,
  ""
);

/** 取某个选择器的声明块（精确匹配，不会命中 .music-ball:hover） */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`未在 globals.css 中找到 ${selector} 规则`);
  return match[1];
}

function zIndexOf(selector: string): number {
  const match = ruleBody(selector).match(/z-index:\s*(-?\d+)/);
  if (!match) throw new Error(`${selector} 未声明 z-index`);
  return Number(match[1]);
}

describe("音乐侧栏：不占布局", () => {
  it("收起态是一颗圆钮，而不是常驻竖栏", () => {
    const body = ruleBody(".music-ball");
    expect(body).toMatch(/position:\s*fixed/);
    // 40px 方形 + 全圆角 = 圆点；一旦改回宽条（竖栏）就会在这里被拦下
    expect(body).toMatch(/width:\s*2\.5rem/);
    expect(body).toMatch(/height:\s*2\.5rem/);
    expect(body).toMatch(/border-radius:\s*999px/);
  });

  it("圆钮贴右下角：与左上角的悬浮歌词胶囊分居对角，不抢同一块位置", () => {
    const body = ruleBody(".music-ball");
    expect(body).toMatch(/right:\s*1rem/);
    expect(body).toMatch(/bottom:\s*1rem/);
  });

  it("抽屉与遮罩都是 fixed（<main> 是滚动容器，只有 fixed 不被裁）", () => {
    expect(ruleBody(".music-drawer")).toMatch(/position:\s*fixed/);
    expect(ruleBody(".music-drawer-scrim")).toMatch(/position:\s*fixed/);
  });

  it("抽屉宽度自适应窄屏，不做横向溢出", () => {
    expect(ruleBody(".music-drawer")).toMatch(/width:\s*min\(20rem,\s*calc\(100vw - 2rem\)\)/);
  });
});

describe("音乐侧栏：层级不得越层", () => {
  it("圆钮与抽屉都低于公告弹窗(85) 与音乐列表弹窗(200)", () => {
    const ball = zIndexOf(".music-ball");
    const drawer = zIndexOf(".music-drawer");
    expect(ball).toBeLessThan(zIndexOf(".notice-scrim"));
    expect(drawer).toBeLessThan(zIndexOf(".notice-scrim"));
    expect(drawer).toBeLessThan(zIndexOf(".mp-scrim"));
    expect(drawer).toBeLessThan(zIndexOf(".ctx-menu"));
  });

  it("遮罩在抽屉之下、在圆钮之上（否则点不中抽屉）", () => {
    expect(zIndexOf(".music-ball")).toBeLessThan(zIndexOf(".music-drawer-scrim"));
    expect(zIndexOf(".music-drawer-scrim")).toBeLessThan(zIndexOf(".music-drawer"));
  });
});

describe("音乐侧栏：玻璃质感同源", () => {
  it("底色 / 模糊 / 圆角 / 投影全部读站内令牌", () => {
    const drawer = ruleBody(".music-drawer");
    expect(drawer).toMatch(/background-color:\s*rgba\(\s*0,\s*0,\s*0,\s*calc\(var\(--card-alpha/);
    expect(drawer).toMatch(/backdrop-filter:\s*blur\(calc\(var\(--glass-blur/);
    expect(drawer).toMatch(/-webkit-backdrop-filter:\s*blur\(calc\(var\(--glass-blur/);
    expect(drawer).toMatch(/border-radius:\s*var\(--radius-/);
    expect(drawer).toMatch(/box-shadow:\s*var\(--shadow-/);

    // 圆钮是单层玻璃，不与抽屉同档加厚
    expect(ruleBody(".music-ball")).toMatch(/backdrop-filter:\s*blur\(var\(--glass-blur/);
  });

  it("强调色只认 --accent-color", () => {
    expect(ruleBody(".music-play-btn")).toMatch(/var\(--accent-color/);
    expect(ruleBody(".music-ball[data-playing=\"true\"]")).toMatch(/var\(--accent-color/);
  });
});

describe("音乐侧栏：无障碍与动效克制", () => {
  it("系统开启「减弱动态效果」时抽屉不做位移、封面不自转", () => {
    const block = css.match(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.music-drawer\s*\{[^}]*\}\s*\.music-ball\[data-playing="true"\] \.music-ball-disc\s*\{[^}]*\}/
    );
    expect(block, "缺少 reduced-motion 处理").toBeTruthy();
    expect(block![0]).toMatch(/animation:\s*none/);
  });

  it("五个可点元素都有强调色焦点环（键盘可达）", () => {
    const focus = css.match(/\.music-ball:focus-visible,[\s\S]*?\{([^}]*)\}/);
    expect(focus, "缺少侧栏的 focus-visible 规则").toBeTruthy();
    expect(focus![1]).toMatch(/outline:\s*2px solid color-mix\(in srgb, var\(--accent-color/);
    for (const selector of [".music-icon-btn:focus-visible", ".music-play-btn:focus-visible"]) {
      expect(css).toContain(selector);
    }
  });
});
