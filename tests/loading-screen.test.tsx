// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { LoadingScreen } from "@/components/LoadingScreen";

describe("LoadingScreen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 模拟 jsdom 中 readyState 非 complete，让隐藏逻辑走 load 事件分支
    Object.defineProperty(document, "readyState", {
      configurable: true,
      value: "loading",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    // 清理跨测试残留的背景就绪标记，避免影响后续用例
    delete (window as unknown as { __bgReady?: boolean }).__bgReady;
  });

  it("enabled=true 时渲染加载动画遮罩", () => {
    render(<LoadingScreen enabled siteName="测试站" />);
    const wrapper = document.getElementById("loader-wrapper");
    expect(wrapper).not.toBeNull();
    expect(screen.getByText("测试站")).toBeInTheDocument();
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("enabled=false 时不渲染任何内容", () => {
    const { container } = render(<LoadingScreen enabled={false} siteName="测试站" />);
    expect(container).toBeEmptyDOMElement();
    expect(document.getElementById("loader-wrapper")).toBeNull();
  });

  it("siteName 缺省时显示默认标题", () => {
    render(<LoadingScreen enabled />);
    expect(screen.getByText("个人主页")).toBeInTheDocument();
  });

  it("最短展示时间后（背景就绪+页面加载完成）触发隐藏", () => {
    render(<LoadingScreen enabled />);
    const wrapper = document.getElementById("loader-wrapper")!;
    expect(wrapper.classList.contains("loader-loaded")).toBe(false);

    // 推进超过最短展示时间 800ms
    act(() => {
      vi.advanceTimersByTime(800);
    });
    // 就绪条件未满足（readyState=loading / bgReady=false），尚未隐藏
    expect(wrapper.classList.contains("loader-loaded")).toBe(false);

    // 模拟真实加载完成：背景就绪 + 页面加载完成（真实浏览器 load 触发后 readyState 为 complete）
    act(() => {
      (window as unknown as { __bgReady?: boolean }).__bgReady = true;
      Object.defineProperty(document, "readyState", {
        configurable: true,
        value: "complete",
      });
      window.dispatchEvent(new Event("background-ready"));
    });
    expect(wrapper.classList.contains("loader-loaded")).toBe(true);
  });

  it("页面已加载完成且背景就绪时隐藏", () => {
    Object.defineProperty(document, "readyState", {
      configurable: true,
      value: "complete",
    });
    render(<LoadingScreen enabled />);

    // 背景就绪后组件立即复查并隐藏（无需等待 load 事件）
    act(() => {
      (window as unknown as { __bgReady?: boolean }).__bgReady = true;
      window.dispatchEvent(new Event("background-ready"));
      vi.advanceTimersByTime(800);
    });
    const wrapper = document.getElementById("loader-wrapper")!;
    expect(wrapper.classList.contains("loader-loaded")).toBe(true);
  });

  it("隐藏动画结束后移除遮罩节点", () => {
    render(<LoadingScreen enabled />);
    act(() => {
      vi.advanceTimersByTime(800);
    });
    // 就绪信号到位 → 触发隐藏（分屏收起动画开始）
    act(() => {
      (window as unknown as { __bgReady?: boolean }).__bgReady = true;
      Object.defineProperty(document, "readyState", {
        configurable: true,
        value: "complete",
      });
      window.dispatchEvent(new Event("background-ready"));
    });
    // loaded 类已添加，此时节点仍在（动画中）
    expect(document.getElementById("loader-wrapper")).not.toBeNull();
    // 推进超过动画总时长（分屏收起 0.8s + 整体上移 1.3s），留 1400ms 后移除
    act(() => {
      vi.advanceTimersByTime(1400);
    });
    expect(document.getElementById("loader-wrapper")).toBeNull();
  });

  it("卸载时清理计时器与监听器", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<LoadingScreen enabled />);
    unmount();
    expect(removeSpy).toHaveBeenCalledWith("background-ready", expect.any(Function));
  });
});
