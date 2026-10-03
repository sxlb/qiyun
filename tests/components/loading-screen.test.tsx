// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { LoadingScreen } from "@/components/home/LoadingScreen";

/** 构造一个 transitionend 事件（jsdom 不保证提供 TransitionEvent 构造器） */
function transitionEnd(propertyName: string, bubbles = false): Event {
  const event = new Event("transitionend", { bubbles });
  Object.defineProperty(event, "propertyName", { value: propertyName });
  return event;
}

/** 让「最短展示已过 + 壁纸就绪」这一对信号到齐，进入收起动画 */
function enterExitAnimation(wrapper: HTMLElement) {
  act(() => {
    vi.advanceTimersByTime(800);
  });
  act(() => {
    (window as unknown as { __bgReady?: boolean }).__bgReady = true;
    window.dispatchEvent(new Event("background-ready"));
  });
  expect(wrapper.classList.contains("loader-loaded")).toBe(true);
}

describe("LoadingScreen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
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
    // 分屏遮罩与三环动画结构完整（配色由 CSS 令牌提供，不再内联写死颜色）
    expect(wrapper!.querySelectorAll(".loader-section")).toHaveLength(2);
    expect(wrapper!.querySelectorAll(".loader-circle")).toHaveLength(1);
    expect(wrapper!.querySelector(".loader-section")!.getAttribute("style")).toBeNull();
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

  it("最短展示与壁纸就绪两个信号到齐才收起", () => {
    render(<LoadingScreen enabled />);
    const wrapper = document.getElementById("loader-wrapper")!;
    expect(wrapper.classList.contains("loader-loaded")).toBe(false);

    // 只过了最短展示时间、壁纸尚未就绪 → 不能收起
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(wrapper.classList.contains("loader-loaded")).toBe(false);

    // 壁纸就绪 → 收起
    act(() => {
      (window as unknown as { __bgReady?: boolean }).__bgReady = true;
      window.dispatchEvent(new Event("background-ready"));
    });
    expect(wrapper.classList.contains("loader-loaded")).toBe(true);
  });

  it("壁纸先就绪、最短展示后到时也能收起（信号顺序倒置）", () => {
    render(<LoadingScreen enabled />);
    const wrapper = document.getElementById("loader-wrapper")!;

    // 壁纸先到：此时最短展示未过，只记录状态
    act(() => {
      (window as unknown as { __bgReady?: boolean }).__bgReady = true;
      window.dispatchEvent(new Event("background-ready"));
    });
    expect(wrapper.classList.contains("loader-loaded")).toBe(false);

    // 最短展示到点 → 复查标记并收起
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(wrapper.classList.contains("loader-loaded")).toBe(true);
  });

  it("包裹层 transform 过渡结束后立即移除节点（事件驱动，不等兜底计时器）", () => {
    render(<LoadingScreen enabled />);
    const wrapper = document.getElementById("loader-wrapper")!;
    enterExitAnimation(wrapper);

    // 动画中节点仍在
    expect(document.getElementById("loader-wrapper")).not.toBeNull();

    act(() => {
      wrapper.dispatchEvent(transitionEnd("transform"));
    });
    expect(document.getElementById("loader-wrapper")).toBeNull();
  });

  it("非 transform 属性 / 子元素的过渡结束不会提前移除节点", () => {
    render(<LoadingScreen enabled />);
    const wrapper = document.getElementById("loader-wrapper")!;
    enterExitAnimation(wrapper);

    act(() => {
      // 包裹层同一时刻还有 visibility 过渡，不认
      wrapper.dispatchEvent(transitionEnd("visibility"));
      // 分屏子元素的 transform 会冒泡上来，target 过滤必须挡住
      wrapper.querySelector(".loader-section-left")!.dispatchEvent(transitionEnd("transform", true));
    });
    expect(document.getElementById("loader-wrapper")).not.toBeNull();

    // 兜底计时器仍能收尾
    act(() => {
      vi.advanceTimersByTime(1400);
    });
    expect(document.getElementById("loader-wrapper")).toBeNull();
  });

  it("兜底计时器在过渡事件缺失时移除遮罩", () => {
    render(<LoadingScreen enabled />);
    const wrapper = document.getElementById("loader-wrapper")!;
    enterExitAnimation(wrapper);

    act(() => {
      vi.advanceTimersByTime(1400);
    });
    expect(document.getElementById("loader-wrapper")).toBeNull();
  });

  it("移除遮罩后广播 loading-screen-removed，且恰好一次", () => {
    const listener = vi.fn();
    window.addEventListener("loading-screen-removed", listener);
    render(<LoadingScreen enabled />);
    const wrapper = document.getElementById("loader-wrapper")!;
    enterExitAnimation(wrapper);

    act(() => {
      // 事件与兜底计时器可能几乎同时到达：重复触发不得重复广播
      wrapper.dispatchEvent(transitionEnd("transform"));
      wrapper.dispatchEvent(transitionEnd("transform"));
      vi.advanceTimersByTime(1400);
    });
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener("loading-screen-removed", listener);
  });

  it("安全兜底：壁纸始终不就绪时最长 7s 强制收起", () => {
    render(<LoadingScreen enabled />);
    const wrapper = document.getElementById("loader-wrapper")!;

    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(wrapper.classList.contains("loader-loaded")).toBe(false);

    act(() => {
      vi.advanceTimersByTime(7000);
    });
    expect(wrapper.classList.contains("loader-loaded")).toBe(true);
  });

  it("卸载时通过 AbortController 一次性回收全部监听", () => {
    const abortSpy = vi.spyOn(AbortController.prototype, "abort");
    const { unmount } = render(<LoadingScreen enabled />);
    unmount();
    expect(abortSpy).toHaveBeenCalledTimes(1);
  });

  it("卸载后到达的 background-ready 不再触发状态更新", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = render(<LoadingScreen enabled />);
    const wrapper = document.getElementById("loader-wrapper")!;
    unmount();

    act(() => {
      (window as unknown as { __bgReady?: boolean }).__bgReady = true;
      window.dispatchEvent(new Event("background-ready"));
      wrapper.dispatchEvent(transitionEnd("transform"));
      vi.advanceTimersByTime(7000);
    });
    expect(errorSpy).not.toHaveBeenCalled();
    expect(document.getElementById("loader-wrapper")).toBeNull();
  });
});
