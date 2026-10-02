// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { DynamicTitle } from "@/components/DecorativeEffects";

describe("DynamicTitle", () => {
  const originalTitle = document.title;

  beforeEach(() => {
    document.title = originalTitle;
    vi.useFakeTimers();
  });

  afterEach(() => {
    document.title = originalTitle;
    vi.useRealTimers();
  });

  it("enabled=false 时不修改页面标题", () => {
    render(<DynamicTitle enabled={false} siteName="测试站" />);
    expect(document.title).toBe(originalTitle);
  });

  it("enabled=true 时立即设置问候语标题", () => {
    render(<DynamicTitle enabled siteName="测试站" />);
    expect(document.title).toContain("测试站");
    // 问候语来源于时间段
    expect(document.title).toMatch(/早上好|上午好|下午好|晚上好|夜深了/);
  });

  it("播放音乐时标题显示歌名与歌手", () => {
    render(<DynamicTitle enabled siteName="测试站" />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent("music-track-change", {
          detail: { name: "晴天", artist: "周杰伦" },
        })
      );
    });
    expect(document.title).toBe("晴天 - 周杰伦 - 测试站");
  });

  it("music-track-change 无有效 detail 时恢复问候语标题", () => {
    render(<DynamicTitle enabled siteName="测试站" />);
    act(() => {
      window.dispatchEvent(new CustomEvent("music-track-change", { detail: undefined }));
    });
    expect(document.title).toContain("测试站");
    expect(document.title).toMatch(/早上好|上午好|下午好|晚上好|夜深了/);
  });

  it("播放器关闭事件恢复问候语标题", () => {
    render(<DynamicTitle enabled siteName="测试站" />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent("music-track-change", {
          detail: { name: "晴天", artist: "周杰伦" },
        })
      );
    });
    expect(document.title).toBe("晴天 - 周杰伦 - 测试站");

    act(() => {
      window.dispatchEvent(new Event("music-player-close"));
    });
    expect(document.title).toContain("测试站");
  });

  it("卸载时移除事件监听并恢复默认标题", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<DynamicTitle enabled siteName="测试站" />);
    unmount();
    expect(removeSpy).toHaveBeenCalledWith("music-track-change", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("music-player-close", expect.any(Function));
    expect(document.title).toBe("测试站");
  });
});
