import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * 音乐侧栏的「可辨识 + 不越层」契约。
 *
 * 背景：音乐控制原本内嵌在右栏功能卡的一格里（与一言互换）。内容容器是
 * max-w-6xl(1152px) + md:px-6，视口 1280px 时左右各只剩 64px、1024px 时只剩 24px ——
 * 常驻全高竖栏会压住时钟卡 / 导航卡。所以侧栏必须满足：
 * 1. 收起态是**有边界的竖直把手**（不是全高竖栏，也不是容易被忽略的小圆点）；
 * 2. 把手自带可见提示：方向箭头 + 竖排曲名（用户反馈「圆点太容易被忽略」）；
 * 3. 浮层用 fixed：<main> 是 h-dvh 的滚动容器，只有 fixed 才不被它裁掉、也不计入 scrollHeight；
 * 4. 层级低于公告弹窗与音乐列表弹窗，弹窗打开时被遮罩盖住而不是压在上面；
 * 5. 玻璃质感读站内令牌，不自己写死一套配色。
 */
const ROOT = new URL("../../", import.meta.url);
const css = readFileSync(new URL("app/globals.css", ROOT), "utf8").replace(
  // 去注释，避免注释里的措辞干扰断言
  /\/\*[\s\S]*?\*\//g,
  ""
);
const component = readFileSync(new URL("components/home/MusicPlayer.tsx", ROOT), "utf8");

/** 取某个选择器的声明块（精确匹配，不会命中 .music-handle:hover） */
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

describe("音乐侧栏：收起态是一枚竖直把手", () => {
  it("把手贴右下角且是胶囊形，竖直排布", () => {
    const body = ruleBody(".music-handle");
    expect(body).toMatch(/position:\s*fixed/);
    expect(body).toMatch(/right:\s*1rem/);
    expect(body).toMatch(/bottom:\s*1rem/);
    // 44px 宽：够放封面 + 竖排文字，也够手指点
    expect(body).toMatch(/width:\s*2\.75rem/);
    expect(body).toMatch(/border-radius:\s*999px/);
    expect(body).toMatch(/flex-direction:\s*column/);
  });

  it("不是全高竖栏：高度随内容自适应，没写死 height", () => {
    // 全高竖栏会压住右栏的时钟卡 / 导航卡；写死 height 是「退回竖栏」的第一步
    expect(ruleBody(".music-handle")).not.toMatch(/(^|;)\s*height:\s*\d/);
  });

  it("把手自带可见提示：方向箭头 + 贴屏强调色把手纹（避免又变回「容易被忽略」的形态）", () => {
    expect(ruleBody(".music-handle-cue")).toMatch(/var\(--accent-color/);
    // 组件里必须真的渲染箭头，否则契约只是空文
    expect(component).toContain("music-handle-cue");
  });

  it("把手不承担信息位：不带常驻曲名文字（需求明确只留把手）", () => {
    // 曲名改由 title 悬浮提示与展开后的抽屉承担；把手一旦重新长出文字，高度与遮挡都会回来
    expect(css).not.toContain(".music-handle-text");
    expect(component).not.toContain("music-handle-text");
    // 曲名仍要在悬浮提示里，不能连信息一起丢掉
    expect(component).toMatch(/title=\{track \? `音乐控制 · \$\{track\.name\}` : "音乐控制"\}/);
  });

  it("贴屏一侧有强调色把手纹（呼应参考项目的贴边标签）", () => {
    const body = ruleBody(".music-handle::after");
    expect(body).toMatch(/var\(--accent-color/);
    // 3px 而不是 2px：2px 在真实缩放下几乎看不见，等于没有这条提示
    expect(body).toMatch(/width:\s*3px/);
  });
});

describe("音乐侧栏：不占布局", () => {
  it("抽屉与遮罩都是 fixed（<main> 是滚动容器，只有 fixed 不被裁）", () => {
    expect(ruleBody(".music-drawer")).toMatch(/position:\s*fixed/);
    expect(ruleBody(".music-drawer-scrim")).toMatch(/position:\s*fixed/);
  });

  it("抽屉宽度自适应窄屏，不做横向溢出", () => {
    expect(ruleBody(".music-drawer")).toMatch(/width:\s*min\(20rem,\s*calc\(100vw - 2rem\)\)/);
  });
});

describe("音乐侧栏：层级不得越层", () => {
  it("把手与抽屉都低于公告弹窗(85) 与音乐列表弹窗(200)", () => {
    const handle = zIndexOf(".music-handle");
    const drawer = zIndexOf(".music-drawer");
    expect(handle).toBeLessThan(zIndexOf(".notice-scrim"));
    expect(drawer).toBeLessThan(zIndexOf(".notice-scrim"));
    expect(drawer).toBeLessThan(zIndexOf(".mp-scrim"));
    expect(drawer).toBeLessThan(zIndexOf(".ctx-menu"));
  });

  it("遮罩在抽屉之下、在把手之上（否则点不中抽屉）", () => {
    expect(zIndexOf(".music-handle")).toBeLessThan(zIndexOf(".music-drawer-scrim"));
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

    // 把手是单层玻璃，不与抽屉同档加厚
    expect(ruleBody(".music-handle")).toMatch(/backdrop-filter:\s*blur\(var\(--glass-blur/);
  });

  it("强调色只认 --accent-color", () => {
    expect(ruleBody(".music-play-btn")).toMatch(/var\(--accent-color/);
    expect(ruleBody('.music-handle[data-playing="true"]')).toMatch(/var\(--accent-color/);
  });
});

describe("音乐侧栏：封面自转不从 0° 重来", () => {
  it("动画常驻声明，只用 animation-play-state 切播放/暂停", () => {
    // 旧写法「[data-playing] 时才挂 animation」会让暂停后再播放从 0° 重转一圈
    const disc = ruleBody(".music-handle-disc");
    expect(disc).toMatch(/animation:\s*music-spin/);
    expect(disc).toMatch(/animation-play-state:\s*paused/);

    const playing = ruleBody('.music-handle[data-playing="true"] .music-handle-disc');
    expect(playing).toMatch(/animation-play-state:\s*running/);
    expect(playing, "播放态不得重新声明 animation 简写，否则动画会被重置").not.toMatch(/animation:\s*music-spin/);
  });
});

describe("音乐侧栏：无障碍与动效克制", () => {
  it("系统开启「减弱动态效果」时抽屉不做位移、封面不自转", () => {
    const block = css.match(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.music-drawer\s*\{[^}]*\}\s*\.music-handle\[data-playing="true"\] \.music-handle-disc\s*\{[^}]*\}/
    );
    expect(block, "缺少 reduced-motion 处理").toBeTruthy();
    expect(block![0]).toMatch(/animation:\s*none/);
  });

  it("可点元素都有强调色焦点环（键盘可达）", () => {
    const focus = css.match(/\.music-handle:focus-visible,[\s\S]*?\{([^}]*)\}/);
    expect(focus, "缺少侧栏的 focus-visible 规则").toBeTruthy();
    expect(focus![1]).toMatch(/outline:\s*2px solid color-mix\(in srgb, var\(--accent-color/);
    for (const selector of [".music-icon-btn:focus-visible", ".music-play-btn:focus-visible"]) {
      expect(css).toContain(selector);
    }
  });
});
