// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { DynamicTitle } from "@/components/home/DecorativeEffects";

/**
 * 动态标题的可见性规则：前台必须显示站点名（标签页、书签、历史记录都靠它辨认），
 * 问候语与歌名只在切到后台时出现 —— 这两条信息只有看不见页面时才有价值。
 *
 * 原来的实现是无条件替换标题，于是前台也一直显示「夜深了，欢迎访问 …」，
 * 用户实测反馈就是「标签页一直提示，不显示标题」。
 */
function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
}

/** 模拟切换标签页：改 hidden 并派发 visibilitychange */
function switchTab(hidden: boolean) {
  setHidden(hidden);
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

const GREETING = /早上好|上午好|下午好|晚上好|夜深了/;

describe("DynamicTitle", () => {
  // 页面自身的标题与站点名故意取不同值：这样才能验证卸载时还原的是「页面标题」，
  // 而不是把组件里的站点名写回去
  const PAGE_TITLE = "测试站 · 个人主页";
  const SITE = "测试站";

  beforeEach(() => {
    document.title = PAGE_TITLE;
    setHidden(false);
    vi.useFakeTimers();
  });

  afterEach(() => {
    document.title = PAGE_TITLE;
    setHidden(false);
    vi.useRealTimers();
  });

  it("enabled=false 时不修改页面标题", () => {
    render(<DynamicTitle enabled={false} siteName={SITE} />);
    expect(document.title).toBe(PAGE_TITLE);
  });

  it("前台显示站点名，不显示问候语", () => {
    render(<DynamicTitle enabled siteName={SITE} />);
    expect(document.title).toBe(SITE);
  });

  it("切到后台显示时间段问候语，切回前台恢复站点名", () => {
    render(<DynamicTitle enabled siteName={SITE} />);

    switchTab(true);
    expect(document.title).toContain(SITE);
    expect(document.title).toMatch(GREETING);

    switchTab(false);
    expect(document.title).toBe(SITE);
  });

  it("后台播放音乐时显示歌名与歌手，切回前台仍是站点名", () => {
    render(<DynamicTitle enabled siteName={SITE} />);
    switchTab(true);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("music-track-change", {
          detail: { name: "晴天", artist: "周杰伦" },
        })
      );
    });
    expect(document.title).toBe(`晴天 - 周杰伦 - ${SITE}`);

    switchTab(false);
    expect(document.title).toBe(SITE);
  });

  it("后台收到无有效 detail 的 music-track-change 时回落到问候语", () => {
    render(<DynamicTitle enabled siteName={SITE} />);
    switchTab(true);

    act(() => {
      window.dispatchEvent(new CustomEvent("music-track-change", { detail: undefined }));
    });
    expect(document.title).toContain(SITE);
    expect(document.title).toMatch(GREETING);
  });

  it("后台关闭播放器后回落到问候语", () => {
    render(<DynamicTitle enabled siteName={SITE} />);
    switchTab(true);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("music-track-change", {
          detail: { name: "晴天", artist: "周杰伦" },
        })
      );
    });
    expect(document.title).toBe(`晴天 - 周杰伦 - ${SITE}`);

    act(() => {
      window.dispatchEvent(new Event("music-player-close"));
    });
    expect(document.title).toMatch(GREETING);
  });

  it("卸载时移除全部监听并还原页面原有标题", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const docSpy = vi.spyOn(document, "removeEventListener");
    const { unmount } = render(<DynamicTitle enabled siteName={SITE} />);

    unmount();

    expect(removeSpy).toHaveBeenCalledWith("music-track-change", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("music-player-close", expect.any(Function));
    expect(docSpy).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    expect(document.title).toBe(PAGE_TITLE);
  });
});
