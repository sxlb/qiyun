import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import dns from "node:dns";
import { createRedirectAwareFetch } from "./helpers/redirect-aware-fetch";

import { faviconCandidates, probeFavicon } from "@/lib/favicon";

const HOST = "github.com";
const [PRIMARY, SECOND, THIRD, FOURTH] = faviconCandidates(HOST).map((c) => c.url);

/** 构造一个带 content-type 的假响应 */
function imageResponse(contentType: string, status = 200) {
  return new Response(new Uint8Array([1, 2, 3]), {
    status,
    headers: { "content-type": contentType },
  });
}

describe("probeFavicon（候选源探测策略）", () => {
  beforeEach(() => {
    // 只替换 DNS 结果，SSRF 校验（含重定向的逐跳复核）一律走真实实现，测试因此不依赖网络。
    // 需要「域名解析失败」的用例在自身内部覆盖这层 spy。
    vi.spyOn(dns.promises, "lookup").mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ] as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("站点自身 favicon.ico 可用时直接采用，不再请求第三方源", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) =>
      String(url) === PRIMARY ? imageResponse("image/x-icon") : imageResponse("image/png"),
    );
    vi.stubGlobal("fetch", fetchMock);

    const hit = await probeFavicon(HOST);

    expect(hit?.url).toBe(PRIMARY);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("站点自身图标不可用时，按优先级取其余源中第一个成功的", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u === PRIMARY) return imageResponse("text/html", 404);
      if (u === SECOND) return imageResponse("image/svg+xml");
      return imageResponse("image/png");
    });
    vi.stubGlobal("fetch", fetchMock);

    const hit = await probeFavicon(HOST);

    // favicon.im（第二个候选）优先级高于 iowen / Google
    expect(hit?.url).toBe(SECOND);
  });

  it("返回 HTML 的候选视为无效（避免把 SPA 首页当成图标）", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u === PRIMARY) return imageResponse("text/html");
      if (u === SECOND) return imageResponse("image/svg+xml");
      return imageResponse("image/png");
    });
    vi.stubGlobal("fetch", fetchMock);

    const hit = await probeFavicon(HOST);

    expect(hit?.url).toBe(SECOND);
  });

  it("所有候选都不可用（含 4xx / HTML / 异常）时返回 null", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(await probeFavicon(HOST)).toBeNull();
    // 主候选 1 次 + 其余候选并行各 1 次
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("目标域名无法解析时直接返回 null，且不发起任何请求", async () => {
    vi.spyOn(dns.promises, "lookup").mockRejectedValue(new Error("ENOTFOUND"));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await probeFavicon(HOST)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("所有候选地址都带上目标主机，第三方源不会串到别的主机", async () => {
    const requested: string[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      requested.push(String(url));
      return imageResponse("image/png", 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    await probeFavicon("sxlb.xyz");

    expect(requested).toContain(THIRD.replace(HOST, "sxlb.xyz"));
    expect(requested).toContain(FOURTH.replace(HOST, "sxlb.xyz"));
    expect(requested.every((u) => u.includes("sxlb.xyz"))).toBe(true);
  });

  it("重定向到内网地址时不跟随（防盲 SSRF）", async () => {
    // 127.0.0.1 是字面量私网地址，SSRF 校验会直接拒绝，不需要 DNS 参与。
    // 内网跳转目标故意返回一张**合法图片**：这样一旦退化成 redirect:"follow"，
    // 探测会「成功」并暴露内网内容，用例会立刻失败，而不是静默通过。
    const { fn, requested } = createRedirectAwareFetch((u) => {
      if (u === PRIMARY) {
        return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/secret" } });
      }
      if (u.includes("127.0.0.1")) return imageResponse("image/png");
      return imageResponse("image/png", 404);
    });
    vi.stubGlobal("fetch", fn);

    expect(await probeFavicon(HOST)).toBeNull();
    // 关键：从未真正请求过内网地址
    expect(requested.every((u) => !u.includes("127.0.0.1"))).toBe(true);
  });

  it("重定向到公网地址时正常跟随（不影响真实图标源）", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u === PRIMARY) {
        return new Response(null, { status: 302, headers: { location: "https://cdn.example.com/icon.png" } });
      }
      if (u === "https://cdn.example.com/icon.png") return imageResponse("image/png");
      return imageResponse("image/png", 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    expect((await probeFavicon(HOST))?.url).toBe(PRIMARY);
  });

  it("重定向次数超过上限时放弃该候选", async () => {
    let n = 0;
    const fetchMock = vi.fn(async () => {
      n += 1;
      return new Response(null, {
        status: 302,
        headers: { location: `https://loop.example.com/${n}` },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(await probeFavicon(HOST)).toBeNull();
  });
});
