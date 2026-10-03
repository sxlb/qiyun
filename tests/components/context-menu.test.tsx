// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, createEvent, waitFor } from "@testing-library/react";
import MusicProvider from "@/components/home/MusicPlayer";
import ContextMenu from "@/components/home/ContextMenu";
import type { RightClickMode } from "@/lib/rightClick";

/**
 * 自定义右键菜单的行为回归。
 *
 * 必须挂在 MusicProvider 内（组件用 useMusic() 取播放状态与「打开音乐列表」），
 * 因此这里渲染真实的 Provider —— 测的是「菜单 → 播放器」这条真实链路，而不是桩。
 */

function setup(options: {
  mode: RightClickMode;
  coverType?: string;
  commandPaletteEnabled?: boolean;
}) {
  return render(
    <MusicProvider songApi="" songId="" autoplay={false}>
      <ContextMenu
        mode={options.mode}
        coverType={options.coverType ?? "bing"}
        commandPaletteEnabled={options.commandPaletteEnabled ?? true}
      />
      <div data-testid="page">页面内容</div>
      <a data-testid="link" href="https://other.com/y">
        外部链接
      </a>
      <input data-testid="field" />
    </MusicProvider>
  );
}

/** 派发一次右键，返回事件对象（用于断言是否被 preventDefault） */
function rightClick(el: Element, point = { clientX: 120, clientY: 90 }) {
  const event = createEvent.contextMenu(el, { bubbles: true, cancelable: true, ...point });
  fireEvent(el, event);
  return event;
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
  // jsdom 未实现滚动：stub 掉，避免 "Not implemented" 噪音并便于断言
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("default 模式", () => {
  it("既不拦截也不弹菜单（完全不介入页面）", () => {
    setup({ mode: "default" });
    const event = rightClick(screen.getByTestId("page"));
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("disabled 模式", () => {
  it("拦截右键但不弹任何菜单", () => {
    setup({ mode: "disabled" });
    const event = rightClick(screen.getByTestId("page"));
    expect(event.defaultPrevented).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("输入框里保留原生菜单（否则无法粘贴）", () => {
    setup({ mode: "disabled" });
    const event = rightClick(screen.getByTestId("field"));
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("menu 模式", () => {
  it("弹出菜单并带上站内功能条目", () => {
    setup({ mode: "menu" });
    rightClick(screen.getByTestId("page"));

    const menu = screen.getByRole("menu");
    expect(menu).toBeTruthy();
    expect(screen.getByText("回到顶部")).toBeTruthy();
    expect(screen.getByText("复制本页链接")).toBeTruthy();
    expect(screen.getByText("打开命令面板")).toBeTruthy();
    // 默认歌单为空：切歌类条目不该出现（点了没反应最伤体验）
    expect(screen.queryByText("播放 / 暂停")).toBeNull();
    expect(screen.getByText("打开音乐列表")).toBeTruthy();
  });

  it("从右键落点定位：菜单出现在光标位置", () => {
    setup({ mode: "menu" });
    rightClick(screen.getByTestId("page"), { clientX: 200, clientY: 150 });
    const menu = screen.getByRole("menu");
    expect(menu.style.left).toBe("200px");
    expect(menu.style.top).toBe("150px");
  });

  it("点击条目先执行动作再关闭菜单", () => {
    setup({ mode: "menu" });
    rightClick(screen.getByTestId("page"));
    fireEvent.click(screen.getByText("回到顶部"));

    expect(window.scrollTo).toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("复制类条目给出「已复制」反馈后再关闭", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    setup({ mode: "menu" });
    rightClick(screen.getByTestId("page"));
    fireEvent.click(screen.getByText("复制本页链接"));

    await waitFor(() => expect(screen.getByText("已复制")).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith(window.location.href);
  });

  it("右键落在链接上时提供「在新标签页打开」", () => {
    setup({ mode: "menu" });
    rightClick(screen.getByTestId("link"));
    expect(screen.getByText("在新标签页打开")).toBeTruthy();
    expect(screen.getByText("复制链接地址")).toBeTruthy();
  });

  it("输入框里右键仍然放行原生菜单", () => {
    setup({ mode: "menu" });
    const event = rightClick(screen.getByTestId("field"));
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Esc 关闭菜单", () => {
    setup({ mode: "menu" });
    rightClick(screen.getByTestId("page"));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("方向键移动高亮，Enter 执行当前项", () => {
    setup({ mode: "menu" });
    rightClick(screen.getByTestId("page"));
    const menu = screen.getByRole("menu");

    // 第一项是「打开音乐列表」，按一次下移应高亮到「回到顶部」
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    const items = screen.getAllByRole("menuitem");
    expect(items[0].className).not.toContain("is-active");
    expect(items[1].className).toContain("is-active");

    fireEvent.keyDown(menu, { key: "Enter" });
    expect(window.scrollTo).toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("在页面别处左键单击即关闭", () => {
    setup({ mode: "menu" });
    rightClick(screen.getByTestId("page"));
    fireEvent.mouseDown(screen.getByTestId("page"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("命令面板被后台关闭后不再展示入口", () => {
    setup({ mode: "menu", commandPaletteEnabled: false });
    rightClick(screen.getByTestId("page"));
    expect(screen.queryByText("打开命令面板")).toBeNull();
  });
});
