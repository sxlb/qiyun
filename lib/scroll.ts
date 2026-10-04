/**
 * 首页单屏外壳的容器 id。
 *
 * 首页把整页高度锁死一屏（`h-dvh`）并关掉页面自身滚动，内容超出时只在 main 内部滚动。
 * 于是「回到顶部」这类操作不能再滚 `window`（window 已经不可滚），必须滚这个容器。
 */
export const HOME_SCROLL_CONTAINER_ID = "home-scroll";

/**
 * 回到顶部。
 *
 * 优先滚首页的单屏容器；找不到时回落到 `window` —— 两种情况都真实存在：
 * 后台等页面仍是整页滚动，而组件在测试里被单独渲染时也不会有这个容器。
 */
export function scrollPageToTop(behavior: ScrollBehavior = "smooth"): void {
  if (typeof document !== "undefined") {
    const box = document.getElementById(HOME_SCROLL_CONTAINER_ID);
    if (box) {
      box.scrollTo({ top: 0, behavior });
      return;
    }
  }
  if (typeof window !== "undefined") {
    window.scrollTo({ top: 0, behavior });
  }
}
