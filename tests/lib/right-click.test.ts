// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  buildContextMenu,
  findLinkHref,
  isEditableTarget,
  normalizeRightClickMode,
  RIGHT_CLICK_MODE_OPTIONS,
  shouldInterceptContextMenu,
  type ContextMenuAction,
} from "@/lib/rightClick";

/** 组一份「什么都没有」的上下文，用例按需覆盖个别字段 */
function ctx(overrides: Partial<Parameters<typeof buildContextMenu>[0]> = {}) {
  return {
    hasSelection: false,
    hasPlaylist: false,
    canSwitchWallpaper: false,
    commandPaletteEnabled: true,
    linkHref: "",
    ...overrides,
  };
}

const actions = (items: { action: ContextMenuAction }[]) => items.map((i) => i.action);

describe("normalizeRightClickMode（右键行为取值收敛）", () => {
  it("三个合法取值原样返回", () => {
    for (const option of RIGHT_CLICK_MODE_OPTIONS) {
      expect(normalizeRightClickMode(option.value)).toBe(option.value);
    }
    expect(RIGHT_CLICK_MODE_OPTIONS.map((o) => o.value)).toEqual([
      "default",
      "disabled",
      "menu",
    ]);
  });

  it("非法值与空值一律回落 default —— 不能在配置写错时把访客的右键换掉", () => {
    for (const bad of ["", "off", "MENU", null, undefined, 0, {}, []]) {
      expect(normalizeRightClickMode(bad)).toBe("default");
    }
  });
});

describe("buildContextMenu（按上下文组装菜单）", () => {
  it("最简上下文：只有「打开音乐列表 / 回到顶部 / 命令面板 / 复制本页链接 / 重新加载」", () => {
    expect(actions(buildContextMenu(ctx()))).toEqual([
      "open-playlist",
      "scroll-top",
      "open-command-palette",
      "copy-page-link",
      "reload-page",
    ]);
  });

  it("右键落在链接上：置顶给出「在新标签页打开 / 复制链接地址」", () => {
    const items = buildContextMenu(ctx({ linkHref: "https://other.com/y" }));
    expect(actions(items)).toEqual([
      "open-link",
      "copy-link-address",
      "open-playlist",
      "scroll-top",
      "open-command-palette",
      "copy-page-link",
      "reload-page",
    ]);
    expect(items[0].group).toBe("link");
  });

  it("有选中文字：复制 / 搜索选中排在链接之后、音乐之前", () => {
    const items = buildContextMenu(
      ctx({ hasSelection: true, linkHref: "https://other.com/y" })
    );
    expect(actions(items).slice(0, 4)).toEqual([
      "open-link",
      "copy-link-address",
      "copy-selection",
      "search-selection",
    ]);
  });

  it("歌单未加载时不出切歌类条目（点了没反应最伤体验）", () => {
    const withoutPlaylist = actions(buildContextMenu(ctx()));
    expect(withoutPlaylist).not.toContain("toggle-play");
    expect(withoutPlaylist).not.toContain("prev-track");
    expect(withoutPlaylist).not.toContain("next-track");
    // 「打开音乐列表」保留：没配歌单时弹窗里会直接提示去后台填写
    expect(withoutPlaylist).toContain("open-playlist");
  });

  it("歌单已加载时补齐播放控制三件套", () => {
    const items = buildContextMenu(ctx({ hasPlaylist: true }));
    expect(actions(items)).toEqual([
      "toggle-play",
      "prev-track",
      "next-track",
      "open-playlist",
      "scroll-top",
      "open-command-palette",
      "copy-page-link",
      "reload-page",
    ]);
    expect(items.filter((i) => i.group === "music")).toHaveLength(4);
  });

  it("壁纸源不支持换一张（必应每日一图 / 自定义地址）时不出现该条目", () => {
    expect(actions(buildContextMenu(ctx()))).not.toContain("next-wallpaper");
    const items = buildContextMenu(ctx({ canSwitchWallpaper: true }));
    expect(actions(items)).toContain("next-wallpaper");
    expect(actions(items).indexOf("next-wallpaper")).toBeLessThan(
      actions(items).indexOf("scroll-top")
    );
  });

  it("命令面板被后台关掉后不再展示入口", () => {
    expect(actions(buildContextMenu(ctx()))).toContain("open-command-palette");
    expect(actions(buildContextMenu(ctx({ commandPaletteEnabled: false })))).not.toContain(
      "open-command-palette"
    );
  });

  it("每组条目相邻，便于组件按组画分隔线", () => {
    const items = buildContextMenu(
      ctx({
        hasSelection: true,
        hasPlaylist: true,
        canSwitchWallpaper: true,
        linkHref: "https://other.com/y",
      })
    );
    expect(items.map((i) => i.group)).toEqual([
      "link",
      "link",
      "selection",
      "selection",
      "music",
      "music",
      "music",
      "music",
      "page",
      "page",
      "page",
      "page",
      "page",
    ]);
  });

  it("每个条目都有非空文案", () => {
    for (const item of buildContextMenu(ctx({ hasSelection: true, hasPlaylist: true }))) {
      expect(item.label.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("shouldInterceptContextMenu（是否拦截这次右键）", () => {
  const div = () => document.createElement("div");

  it("default 模式永不拦截", () => {
    expect(
      shouldInterceptContextMenu({ target: div(), mode: "default", coarsePointer: false })
    ).toBe(false);
  });

  it("disabled / menu 模式在普通元素上拦截", () => {
    for (const mode of ["disabled", "menu"] as const) {
      expect(shouldInterceptContextMenu({ target: div(), mode, coarsePointer: false })).toBe(true);
    }
  });

  it("触屏（粗指针）一律放行：长按原生菜单与选词不可替代", () => {
    for (const mode of ["disabled", "menu"] as const) {
      expect(shouldInterceptContextMenu({ target: div(), mode, coarsePointer: true })).toBe(false);
    }
  });

  it("输入控件 / 下拉 / 可编辑区域放行原生菜单（否则无法粘贴）", () => {
    const editable: HTMLElement[] = [
      document.createElement("input"),
      document.createElement("textarea"),
      document.createElement("select"),
    ];
    const contentEditable = document.createElement("div");
    contentEditable.contentEditable = "true";
    editable.push(contentEditable);

    for (const el of editable) {
      expect(isEditableTarget(el)).toBe(true);
      expect(shouldInterceptContextMenu({ target: el, mode: "menu", coarsePointer: false })).toBe(
        false
      );
    }
  });

  it("非元素 target（如被派发到 document）不视为可编辑", () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(document)).toBe(false);
  });
});

describe("findLinkHref（从右键落点找链接）", () => {
  const BASE = "https://example.com/page";

  it("站在链接的子元素上也能找到祖先链接", () => {
    const anchor = document.createElement("a");
    anchor.setAttribute("href", "/about");
    const span = document.createElement("span");
    anchor.appendChild(span);
    expect(findLinkHref(span, BASE)).toBe("https://example.com/about");
  });

  it("绝对地址原样保留", () => {
    const anchor = document.createElement("a");
    anchor.setAttribute("href", "https://other.com/y");
    expect(findLinkHref(anchor, BASE)).toBe("https://other.com/y");
  });

  it("站内锚点与不可打开的协议一律不算链接", () => {
    for (const href of ["#section", "javascript:void(0)", "mailto:a@b.com", "  "]) {
      const anchor = document.createElement("a");
      anchor.setAttribute("href", href);
      expect(findLinkHref(anchor, BASE)).toBe("");
    }
  });

  it("没有链接祖先时返回空串", () => {
    expect(findLinkHref(document.createElement("div"), BASE)).toBe("");
    expect(findLinkHref(null, BASE)).toBe("");
  });
});
