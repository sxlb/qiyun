import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * 音乐侧栏的「可辨识 + 可拖动 + 不越层」契约。
 *
 * 背景：音乐控制原本内嵌在右栏功能卡的一格里（与一言互换）。内容容器是
 * max-w-6xl(1152px) + md:px-6，视口 1280px 时左右各只剩 64px、1024px 时只剩 24px ——
 * 常驻全高竖栏会压住时钟卡 / 导航卡。所以侧栏必须满足：
 * 1. 收起态是**有边界的竖直把手**（不是全高竖栏，也不是容易被忽略的小圆点）；
 * 2. 把手自带可见提示：方向箭头 + 贴屏强调色把手纹；
 * 3. 位置用 transform 表达（拖动跟手、松手贴合是一条合成层动画，不触发布局）；
 * 4. 停靠侧左右可镜像（默认左侧：把手纹贴左、箭头指向抽屉展开方向）；
 * 5. 浮层用 fixed：<main> 是 h-dvh 的滚动容器，只有 fixed 才不被它裁掉、也不计入 scrollHeight；
 * 6. 层级低于公告弹窗与音乐列表弹窗，弹窗打开时被遮罩盖住而不是压在上面；
 * 7. 玻璃质感读站内令牌，不自己写死一套配色。
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
  it("把手是 44px 宽的贴边标签，竖直排布、可抓取", () => {
    const body = ruleBody(".music-handle");
    expect(body).toMatch(/position:\s*fixed/);
    expect(body).toMatch(/width:\s*2\.75rem/);
    expect(body, "不再是浮空胶囊：贴边一侧直角、内侧半圆").toMatch(
      /border-radius:\s*0 1\.375rem 1\.375rem 0/
    );
    expect(body).toMatch(/flex-direction:\s*column/);
    expect(body).toMatch(/cursor:\s*grab/);
    // 触摸拖动不要变成滚页
    expect(body).toMatch(/touch-action:\s*none/);
  });

  it("不是全高竖栏：高度是一个有边界的固定值，而不是占满视口", () => {
    const body = ruleBody(".music-handle");
    expect(body).toMatch(/height:\s*6\.125rem/);
    expect(body, "全高竖栏会压住右栏的时钟卡 / 导航卡").not.toMatch(/height:\s*(100%|100vh|100dvh|auto)/);
  });

  it("位置用 transform 表达（合成层动画、不触发布局），并有默认兜底", () => {
    const body = ruleBody(".music-handle");
    expect(body).toMatch(/transform:\s*translate3d\(var\(--handle-x/);
    // 未挂载时（SSR / 首帧）要有默认值：左侧贴边贴底，不能先闪到别处
    expect(body, "水平必须贴边（0），留缝就不像挂在屏幕上").toMatch(/--handle-x:\s*0px/);
    expect(body).toMatch(/--handle-y:\s*calc\(100dvh - var\(--handle-inset\) - 6\.125rem\)/);
    expect(body).toMatch(/left:\s*0/);
    expect(body).toMatch(/top:\s*0/);
  });

  it("贴屏一侧不做圆角、内侧做成半圆，并随停靠侧镜像", () => {
    // 贴边一侧直角才像「挂在屏幕上」；内侧 1.375rem = 宽度的一半，正好是半圆
    expect(ruleBody(".music-handle")).toMatch(/border-radius:\s*0 1\.375rem 1\.375rem 0/);
    expect(ruleBody('.music-handle[data-side="right"]')).toMatch(
      /border-radius:\s*1\.375rem 0 0 1\.375rem/
    );
  });

  it("拖动中关掉过渡（跟手）并给出抬起感", () => {
    const body = ruleBody('.music-handle[data-dragging="true"]');
    expect(body).toMatch(/transition:\s*none/);
    expect(body).toMatch(/cursor:\s*grabbing/);
    expect(body).toMatch(/--handle-scale:\s*1\.06/);
  });

  it("自动播放被拦截时给出可照做的提示：把手呼吸圈 + 抽屉文案", () => {
    const body = ruleBody('.music-handle[data-autoplay-blocked="true"]');
    expect(body).toMatch(/animation:\s*music-handle-wait/);
    // 只动 box-shadow、不碰 transform：把手位置由 transform 控制，动画碰它会与拖动打架
    expect(body).not.toMatch(/transform/);
    expect(css).toMatch(/@keyframes music-handle-wait/);
    // 减弱动态效果下退成静态描边，而不是让光圈一直闪
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.music-handle\[data-autoplay-blocked="true"\]\s*\{[^}]*animation:\s*none/
    );
    // 组件侧必须真的绑上这个属性，否则 CSS 契约只是空文
    expect(component).toContain('data-autoplay-blocked={m.autoplayBlocked ? "true" : "false"}');
    // 抽屉是常驻可见时的落点：光晕之外还要有一句读得懂的文字
    expect(ruleBody(".music-drawer-note")).toMatch(/var\(--accent-color/);
    expect(component).toContain("浏览器已阻止自动播放，点击页面任意处即可开始播放");
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
    // 曲名仍要在悬浮提示里，还要带上「可拖动」的暗示，否则没人知道能拖。
    // title 现在是三分支（自动播放被拦截时优先提示"点一下就开始播放"），
    // 因此只断言与曲名相关的两个分支都存在，不去锁整行表达式。
    expect(component).toMatch(/`音乐控制 · \$\{track\.name\}（可拖动）`/);
    expect(component).toContain('"音乐控制（可拖动）"');
  });

  it("贴屏一侧有强调色把手纹，并随停靠侧镜像", () => {
    const stripe = ruleBody(".music-handle::after");
    expect(stripe).toMatch(/var\(--accent-color/);
    // 3px 而不是 2px：2px 在真实缩放下几乎看不见，等于没有这条提示
    expect(stripe).toMatch(/width:\s*3px/);
    expect(ruleBody('.music-handle[data-side="left"]::after')).toMatch(/left:\s*0\.26rem/);
    expect(ruleBody('.music-handle[data-side="right"]::after')).toMatch(/right:\s*0\.26rem/);
  });

  it("箭头始终指向抽屉展开的方向：左侧停靠时镜像 180°", () => {
    const cue = ruleBody('.music-handle[data-side="left"] .music-handle-cue');
    expect(cue).toMatch(/transform:\s*rotate\(180deg\)/);
    // 组件里必须真的带 data-side，否则镜像规则不会生效
    expect(component).toContain("data-side={placement.side}");
  });
});

describe("音乐侧栏：与欢迎通知的时序约定", () => {
  it("按通知遮罩是否在屏上来判断「能不能开始计时」，类名两边必须一致", () => {
    const notice = readFileSync(new URL("components/home/AnnouncementNotification.tsx", ROOT), "utf8");
    // 侧栏拿这个选择器判断通知在不在屏上：改名只改一边就会静默失效（倒计时再也等不到通知）
    expect(component).toContain('".notice-scrim"');
    expect(notice).toContain("notice-scrim");
  });

  it("展开示范只做一次：标记记在 sessionStorage（同一标签页刷新不再打扰）", () => {
    expect(component).toContain("sessionStorage");
    expect(component).toContain("music-sidebar-intro-shown");
  });

  it("与通知的唤出时机对齐（都等加载动画收起，都保留 3 秒兜底）", () => {
    const notice = readFileSync(new URL("components/home/AnnouncementNotification.tsx", ROOT), "utf8");
    // 不对齐就会出现「通知还没弹出来，侧栏已经判定没有通知并开始倒计时」
    for (const marker of ["loading-screen-removed", "loader-wrapper"]) {
      expect(component, `侧栏缺少与通知对齐的 ${marker}`).toContain(marker);
      expect(notice, `通知侧缺少 ${marker}`).toContain(marker);
    }
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

  it("抽屉跟着把手停靠在同一侧", () => {
    expect(ruleBody('.music-drawer[data-side="left"]')).toMatch(/left:\s*1rem/);
    expect(ruleBody('.music-drawer[data-side="left"]')).toMatch(/right:\s*auto/);
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
