// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { TopProgressBar } from "@/components/DecorativeEffects";

describe("TopProgressBar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("enabled=false 时不渲染进度条", () => {
    const { container } = render(<TopProgressBar enabled={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("enabled=true 时渲染进度条容器", () => {
    const { container } = render(<TopProgressBar enabled />);
    expect(container.querySelector(".fixed")).not.toBeNull();
  });

  it("监听 music-progress 事件更新进度宽度", () => {
    const { container } = render(<TopProgressBar enabled />);
    const fill = container.querySelector("div[style]") as HTMLElement;
    expect(fill).not.toBeNull();

    act(() => {
      window.dispatchEvent(
        new CustomEvent("music-progress", {
          detail: { currentTime: 30, duration: 120, playing: true },
        })
      );
    });

    const fillAfter = container.querySelector("div[style]") as HTMLElement;
    expect(fillAfter.style.width).toBe("25%"); // 30/120 = 25%
  });

  it("拖拽时不随进度事件跳变（保留拖拽进度）", () => {
    const { container } = render(<TopProgressBar enabled />);
    const bar = container.querySelector(".progress-interactive") as HTMLElement;

    // 先设置一个基础进度
    act(() => {
      window.dispatchEvent(
        new CustomEvent("music-progress", {
          detail: { currentTime: 30, duration: 120, playing: true },
        })
      );
    });

    // 模拟按下开始拖拽（mouseDown 触发 seekTo，宽度 = 50%）
    const rect = { left: 0, width: 200 } as DOMRect;
    vi.spyOn(bar, "getBoundingClientRect").mockReturnValue(rect);
    act(() => {
      bar.dispatchEvent(
        new MouseEvent("mousedown", { clientX: 100, bubbles: true })
      );
    });

    // 拖拽中收到新的进度事件，宽度不应被覆盖（保持 50%）
    act(() => {
      window.dispatchEvent(
        new CustomEvent("music-progress", {
          detail: { currentTime: 60, duration: 120, playing: true },
        })
      );
    });
    const fillAfter = container.querySelector("div[style]") as HTMLElement;
    expect(fillAfter.style.width).toBe("50%");
  });

  it("mouseup 后恢复跟随进度事件", () => {
    const { container } = render(<TopProgressBar enabled />);
    const bar = container.querySelector(".progress-interactive") as HTMLElement;
    const rect = { left: 0, width: 200 } as DOMRect;
    vi.spyOn(bar, "getBoundingClientRect").mockReturnValue(rect);

    act(() => {
      bar.dispatchEvent(new MouseEvent("mousedown", { clientX: 100, bubbles: true }));
      bar.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    act(() => {
      window.dispatchEvent(
        new CustomEvent("music-progress", {
          detail: { currentTime: 60, duration: 120, playing: true },
        })
      );
    });
    const fillAfter = container.querySelector("div[style]") as HTMLElement;
    expect(fillAfter.style.width).toBe("50%"); // 60/120 = 50%，拖拽状态已解除
  });

  it("拖拽 seek 时更新 audio.currentTime 并广播 music-seek", () => {
    // jsdom 无 audio 播放能力，这里只验证 seekTo 的广播逻辑
    const { container } = render(<TopProgressBar enabled />);
    const bar = container.querySelector(".progress-interactive") as HTMLElement;
    const rect = { left: 0, width: 200 } as DOMRect;
    vi.spyOn(bar, "getBoundingClientRect").mockReturnValue(rect);

    const seekSpy = vi.fn();
    const onSeek = seekSpy as EventListener;
    window.addEventListener("music-seek", onSeek);

    // 先广播一次进度事件，让组件内部 duration=120 就绪
    act(() => {
      window.dispatchEvent(
        new CustomEvent("music-progress", {
          detail: { currentTime: 0, duration: 120, playing: true },
        })
      );
    });

    // 再触发 mousedown 拖拽（此时 duration 已生效）
    act(() => {
      bar.dispatchEvent(new MouseEvent("mousedown", { clientX: 100, bubbles: true }));
    });

    expect(seekSpy).toHaveBeenCalled();
    const evt = seekSpy.mock.calls[0][0] as CustomEvent;
    expect(evt.detail.currentTime).toBeCloseTo(60); // 100/200 * 120
    window.removeEventListener("music-seek", onSeek);
  });

  it("卸载时移除事件监听", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<TopProgressBar enabled />);
    unmount();
    expect(removeSpy).toHaveBeenCalledWith("music-progress", expect.any(Function));
  });
});
