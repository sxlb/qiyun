// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { ClickEffect } from "@/components/DecorativeEffects";

describe("ClickEffect", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("enabled=false 时不渲染容器", () => {
    const { container } = render(<ClickEffect enabled={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("enabled=true 时渲染粒子容器", () => {
    const { container } = render(<ClickEffect enabled />);
    expect(container.querySelector(".pointer-events-none.fixed")).not.toBeNull();
  });

  it("点击页面时生成 8 个粒子", () => {
    render(<ClickEffect enabled />);
    const container = document.querySelector("[aria-hidden]");
    expect(container).not.toBeNull();

    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointerdown", { clientX: 100, clientY: 100, pointerType: "mouse", button: 0 })
      );
    });

    const particles = container!.querySelectorAll("span");
    expect(particles.length).toBe(8);
  });

  it("忽略非鼠标主键点击（右键）", () => {
    render(<ClickEffect enabled />);
    const container = document.querySelector("[aria-hidden]");

    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointerdown", { clientX: 100, clientY: 100, pointerType: "mouse", button: 2 })
      );
    });
    expect(container!.querySelectorAll("span").length).toBe(0);
  });

  it("粒子动画结束后被移除", () => {
    render(<ClickEffect enabled />);
    const container = document.querySelector("[aria-hidden]");

    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointerdown", { clientX: 100, clientY: 100, pointerType: "mouse", button: 0 })
      );
    });
    expect(container!.querySelectorAll("span").length).toBe(8);

    // 推进超过粒子生命周期 650ms
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(container!.querySelectorAll("span").length).toBe(0);
  });

  it("连续点击多次生成多组粒子且可全部清理", () => {
    render(<ClickEffect enabled />);
    const container = document.querySelector("[aria-hidden]");

    act(() => {
      for (let i = 0; i < 3; i++) {
        window.dispatchEvent(
          new PointerEvent("pointerdown", { clientX: 50, clientY: 50, pointerType: "touch" })
        );
      }
    });
    expect(container!.querySelectorAll("span").length).toBe(24);

    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(container!.querySelectorAll("span").length).toBe(0);
  });

  it("卸载时清理所有粒子与监听器", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<ClickEffect enabled />);
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointerdown", { clientX: 10, clientY: 10, pointerType: "mouse", button: 0 })
      );
    });
    const container = document.querySelector("[aria-hidden]");
    expect(container!.querySelectorAll("span").length).toBe(8);

    unmount();
    expect(removeSpy).toHaveBeenCalledWith("pointerdown", expect.any(Function));
    // 卸载后粒子 DOM 已清空
    expect(container!.querySelectorAll("span").length).toBe(0);
  });
});
