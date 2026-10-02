import { vi } from "vitest";

/** 尊重 redirect 语义的 fetch 替身 */
export interface RedirectAwareFetch {
  /** 可直接 vi.stubGlobal("fetch", mock.fn) */
  fn: ReturnType<typeof vi.fn>;
  /** 实际请求过的地址，**含被自动 follow 到的地址** */
  requested: string[];
}

/**
 * 构造一个**尊重 redirect 语义**的 fetch 替身。
 *
 * 为什么需要它：真实的 fetch 在 `redirect: "follow"` 时会自己跟随 3xx，跳转目标不再经过
 * 任何校验。若替身只是把 302 原样返回，它就比现实更「安全」——依赖它的 SSRF 断言会退化成
 * 空断言，被测代码即使改回 `redirect: "follow"` 也照样通过。
 *
 * 因此这里显式实现两种语义：
 * - `redirect: "manual"`：原样返回 3xx，由调用方自己处理 Location
 * - `redirect: "follow"`：按 Location 递归请求，模拟真实 fetch 的自动跟随
 *
 * handler 只需按 URL 返回响应；`requested` 会记录每一跳，供「从未请求过内网地址」这类断言使用。
 */
export function createRedirectAwareFetch(
  handler: (url: string) => Response,
  maxHops = 5
): RedirectAwareFetch {
  const requested: string[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    let current = String(url);
    for (let hop = 0; hop < maxHops; hop++) {
      requested.push(current);
      const res = handler(current);
      const isRedirect = res.status >= 300 && res.status < 400;
      // 只有 follow 才会自动跳转；manual 必须由调用方自己处理
      if (init?.redirect !== "follow" || !isRedirect) return res;
      const location = res.headers.get("location");
      if (!location) return res;
      current = new URL(location, current).toString();
    }
    // 跳数兜底：模拟真实 fetch 的「重定向次数过多」
    return new Response(null, { status: 508 });
  });
  return { fn, requested };
}
