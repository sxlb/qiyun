// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 首页「单屏外壳」的结构契约。
 *
 * 需求是硬约束：页面本身绝对不能出现滚动条；内容超高只能在外壳内部滚动，
 * 且整体尺寸不得超出视口。这条约束靠三件事同时成立：
 *   1. <main> 锁死一屏高度（h-dvh）并自己承接滚动（overflow-y-auto）
 *   2. 滚动不外溢（overscroll-contain），不会带动页面
 *   3. 「回到顶部」改为滚这个容器 —— 页面不可滚后，滚 window 是无效操作
 * 任何一条被改掉，表现都会退化成「整页滚动」或「返回顶部失灵」，这里逐条锁住。
 */

const ROOT = process.cwd();
const page = readFileSync(join(ROOT, "app/page.tsx"), "utf8");
const contextMenu = readFileSync(join(ROOT, "components/home/ContextMenu.tsx"), "utf8");
const commandPalette = readFileSync(join(ROOT, "components/home/CommandPalette.tsx"), "utf8");

describe("首页单屏外壳", () => {
  it("<main> 使用滚动容器 id 承接内部滚动", () => {
    expect(page).toContain("id={HOME_SCROLL_CONTAINER_ID}");
  });

  it("<main> 锁死一屏高度并自己滚动，且不允许滚动外溢", () => {
    const mainTag = page.match(/<main[^>]*>/)?.[0] ?? "";
    expect(mainTag).toContain("h-dvh");
    expect(mainTag).toContain("overflow-y-auto");
    expect(mainTag).toContain("overscroll-contain");
  });

  it("「回到顶部」改走容器滚动，不再滚 window", () => {
    // 两处入口（右键菜单 / 命令面板）都必须切过来，漏一处就是「偶发点了没反应」
    expect(contextMenu).toContain("scrollPageToTop(");
    expect(commandPalette).toContain("scrollPageToTop(");
    expect(contextMenu).not.toContain("window.scrollTo");
    expect(commandPalette).not.toContain("window.scrollTo");
  });
});
