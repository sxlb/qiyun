import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * 首页「内容不超出屏幕」的约束契约。
 *
 * 现象：简介多写几句、技能多加几个，卡片就一路长高，把整个外壳顶出屏幕
 * （实测桌面 1416×745 溢出 239px、手机 390×844 溢出 1227px，要滚一屏半）。
 * 站内可变的只有这两处 —— 导航卡按页拆分、功能卡高度固定，都不随内容增长。
 *
 * 收起形态是「固定几行 + 展开弹窗」而不是内嵌滚动条：玻璃卡片里塞一条细滚动条
 * 既不好看也不好按，点开弹窗读全文更舒展。这里锁住四条容易在后续改动中
 * 被破坏的性质：
 * 1. 用 max-height + overflow:hidden 收起，而不是固定 height（height 会把短内容也拉高）；
 * 2. 底部渐隐只在真的溢出时挂上，否则短内容也会被淡掉一截；
 * 3. 桌面按「视口高度减去固定块」分配上限，大屏不截断本就放得下的简介；
 * 4. 组件侧真的绑上了这些类与入口，否则 CSS 契约只是空文。
 */

const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  ""
);
const page = readFileSync(new URL("../../app/page.tsx", import.meta.url), "utf8");
const skillCloud = readFileSync(
  new URL("../../components/home/SkillCloud.tsx", import.meta.url),
  "utf8"
);

/** 从 idx 处的规则开始，按大括号配平取出块内容（不含外层大括号） */
function bracedAt(idx: number): string {
  const start = css.indexOf("{", idx);
  if (start === -1) throw new Error("未找到规则起始大括号");
  let depth = 0;
  for (let i = start; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(start + 1, i);
    }
  }
  throw new Error("规则大括号未闭合");
}

/** 收集所有 @media <query> 块的正文（同名块可能有多处，需自行按内容筛选） */
function mediaBlocks(query: string): string[] {
  const needle = `@media ${query}`;
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const idx = css.indexOf(needle, from);
    if (idx === -1) break;
    out.push(bracedAt(idx));
    from = idx + needle.length;
  }
  return out;
}

const clampBlock = /\.bio-clamp,\s*\.skills-clamp\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
const fadedBlock =
  /\.bio-clamp\.is-clamped,\s*\.skills-clamp\.is-clamped\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";

describe("可变内容区的收起形态", () => {
  it("用 max-height + overflow:hidden 收起，而不是固定 height", () => {
    expect(clampBlock, "未找到 .bio-clamp / .skills-clamp 共享规则").not.toBe("");
    expect(clampBlock).toMatch(/overflow:\s*hidden/);
    // 固定 height 会把简介写得短时也撑出一块空白
    expect(clampBlock).not.toMatch(/[^-]height:/);
    expect(clampBlock).not.toMatch(/overflow-y/);
  });

  it("底部渐隐只在溢出时挂 is-clamped，短内容不会被淡掉一截", () => {
    expect(fadedBlock).toMatch(/mask-image:\s*linear-gradient/);
    // 必须挂在 .is-clamped 上，而不是无条件作用于 .bio-clamp
    expect(css).not.toMatch(/\.bio-clamp\s*\{[^}]*mask-image/);
    expect(css).not.toMatch(/\.skills-clamp\s*\{[^}]*mask-image/);
  });

  it("手机给固定行数上限（单列堆叠塞不进一屏，只能收得更紧）", () => {
    expect(css).toMatch(/\.bio-clamp\s*\{[^}]*max-height:\s*[\d.]+rem/);
    expect(css).toMatch(/\.skills-clamp\s*\{[^}]*max-height:\s*[\d.]+rem/);
  });

  it("桌面按剩余空间分配上限，并让大屏不截断本就放得下的内容", () => {
    const desktop = mediaBlocks("(min-width: 768px)").find((b) => b.includes("100dvh"));
    expect(desktop, "未找到桌面端的自适应上限规则").toBeDefined();
    expect(desktop!).toContain(".bio-clamp");
    expect(desktop!).toContain(".skills-clamp");
    // calc + dvh：上限跟着视口高度走，而不是写死一个值
    expect(desktop!).toMatch(
      /max-height:\s*clamp\([^)]*calc\(\(100dvh\s*-\s*\d+rem\)\s*\/\s*2\)/
    );
  });

  it("「展开」入口压在底部渐隐区上，不额外占用卡片高度", () => {
    const trigger = /\.expand-trigger\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(trigger, "未找到 .expand-trigger 规则").not.toBe("");
    // 绝对定位才不占高度：一旦回到文档流，收起省下的高度会被入口本身吃掉
    expect(trigger).toMatch(/position:\s*absolute/);
    expect(trigger).toMatch(/bottom:/);
  });
});

describe("组件真的接上了收起与展开", () => {
  it("简介正文用 ExpandableContent 包裹，入口文案是「展开全文」", () => {
    expect(page).toContain("<ExpandableContent");
    expect(page).toContain('clampClass="bio-clamp"');
    expect(page).toContain("展开全文");
  });

  it("技能标签区用 ExpandableContent 包裹，且折叠与弹窗共用同一份渲染", () => {
    expect(skillCloud).toContain("<ExpandableContent");
    expect(skillCloud).toContain("skills-clamp");
    // 弹窗内容必须是可复用的同一份（pills），避免两处样式各改一半而漂移
    expect(skillCloud).toMatch(/const pills = skills\.map/);
    expect(skillCloud).toMatch(/dialogContent=\{[^}]*pills/);
  });

  it("弹窗挂到 body 并用高 z-index：内容区在 section 的 z-10 上下文里，就地渲染会被公告盖住", () => {
    const component = readFileSync(
      new URL("../../components/home/ExpandableContent.tsx", import.meta.url),
      "utf8"
    );
    expect(component).toContain("createPortal");
    expect(component).toMatch(/document\.body/);
    expect(component).toMatch(/z-\[150\]/);
  });
});
