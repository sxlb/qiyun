// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { HOME_SCROLL_CONTAINER_ID, scrollPageToTop } from "@/lib/scroll";

/**
 * 「回到顶部」的落点回归。
 *
 * 首页整页锁死一屏（h-dvh），页面自身不再滚动，内容超出时只在 main 容器内滚。
 * 此时若继续滚 window 就是无效操作 —— 必须命中容器。后台等页面仍整页滚动，
 * 所以两条路径都要覆盖。
 */

let elementScrollTo: ReturnType<typeof vi.fn>;
let windowScrollTo: ReturnType<typeof vi.fn>;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  elementScrollTo = vi.fn();
  windowScrollTo = vi.fn();
  // jsdom 没有实现 Element.prototype.scrollTo（属性都不存在），只能直接挂；
  // window.scrollTo 存在但会打到「not implemented」，一并替换掉便于断言命中对象
  (Element.prototype as unknown as { scrollTo: unknown }).scrollTo = elementScrollTo;
  (window as unknown as { scrollTo: unknown }).scrollTo = windowScrollTo;
});

afterEach(() => {
  container?.remove();
  container = null;
});

describe("scrollPageToTop", () => {
  it("容器存在时滚容器，不碰 window", () => {
    container = document.createElement("div");
    container.id = HOME_SCROLL_CONTAINER_ID;
    document.body.appendChild(container);

    scrollPageToTop("smooth");

    expect(elementScrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    expect(windowScrollTo).not.toHaveBeenCalled();
  });

  it("容器不存在时回落到 window（后台等整页滚动页）", () => {
    scrollPageToTop("auto");

    expect(elementScrollTo).not.toHaveBeenCalled();
    expect(windowScrollTo).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
  });

  it("不传行为参数时默认 smooth", () => {
    scrollPageToTop();

    expect(windowScrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });

  it("容器 id 与首页 main 上挂载的 id 一致", () => {
    // 字面量单独断言：防止有人改了常量却忘了改 page.tsx 的 id，导致「回到顶部」静默失效
    expect(HOME_SCROLL_CONTAINER_ID).toBe("home-scroll");
  });
});
