import { describe, it, expect, vi, beforeEach } from "vitest";
import dns from "node:dns";
import { NextRequest } from "next/server";
import { createRedirectAwareFetch } from "./helpers/redirect-aware-fetch";

// Mock 数据库：默认 songApi 为空（私网白名单默认关闭），个别用例覆盖返回
vi.mock("@/lib/db", () => ({
  prisma: {
    profile: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  },
}));

/** 构造音乐接口请求 */
function makeRequest(url: string): NextRequest {
  return new NextRequest(`http://localhost/api/music${url}`, { method: "GET" });
}

const { GET } = await import("@/app/api/music/route");

describe("音乐接口 SSRF 防护", () => {
  const fetchMock = vi.fn();
  // lookup 存在多个重载（单地址 / all 数组），spy 的返回类型无法被 ReturnType 精确表达，
  // 这里用 any 规避重载推断，实际 mock 值由各用例覆盖
  let lookupSpy: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    // 默认 fetch 返回空数组（公网用例覆盖）；每次调用都新建 Response，避免复用同一流
    fetchMock.mockReset();
    fetchMock.mockImplementation(() => Promise.resolve(new Response("[]", { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    // 重置 prisma mock 的 once 队列（clearAllMocks 不清队列），防止跨用例串扰
    const { prisma } = await import("@/lib/db");
    (prisma.profile.findFirst as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockResolvedValue(null);
    // 默认解析为公网 IP；需要私网/解析失败场景的用例单独覆盖
    // （setup.ts 的 restoreAllMocks 会在每个用例后还原 spy）
    lookupSpy = vi
      .spyOn(dns.promises, "lookup")
      .mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as any);
  });

  it("未配置歌单参数时直接返回示例列表，不发起请求", async () => {
    const res = await GET(makeRequest(""));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("api 指向私网 IP 时拒绝并返回示例列表（不发起 fetch）", async () => {
    const res = await GET(
      makeRequest("?api=http://127.0.0.1:3000/api&server=netease&type=playlist&id=1")
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(lookupSpy).not.toHaveBeenCalled(); // 字面量 IP 无需 DNS
  });

  it("api 指向云元数据地址时拒绝", async () => {
    const res = await GET(
      makeRequest("?api=http://169.254.169.254/latest/meta-data&server=netease&type=playlist&id=1")
    );
    expect(await res.json()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("域名解析到私网 IP 时拒绝（防 DNS rebinding）", async () => {
    lookupSpy.mockResolvedValue([{ address: "10.0.0.5", family: 4 }] as any);

    const res = await GET(
      makeRequest("?api=http://evil.example.com/api&server=netease&type=playlist&id=1")
    );
    expect(await res.json()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("DNS 解析失败时拒绝", async () => {
    lookupSpy.mockRejectedValue(new Error("ENOTFOUND"));

    const res = await GET(
      makeRequest("?api=http://no-such-host.invalid/api&server=netease&type=playlist&id=1")
    );
    expect(await res.json()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("公网目标正常代理并返回第三方 JSON", async () => {
    const playlist = [
      { id: 1, name: "歌 A", artist: "歌手 A", url: "https://cdn.example.com/a.mp3" },
    ];
    // 按路径分发：playlist/track/all 返回非 NeteaseCloudMusicApi 结构（回退），其余按 meting 返回
    fetchMock.mockImplementation((url: string) => {
      const u = new URL(url);
      if (u.pathname.includes("/playlist/track/all")) {
        return Promise.resolve(new Response("{}", { status: 200 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify(playlist), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
    });

    const res = await GET(
      makeRequest("?api=https://example.com/api&server=netease&type=playlist&id=123")
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(playlist);
    // 回退分支（meting）的代理目标带上了 server/type/id 参数
    const calledUrl = new URL(fetchMock.mock.calls[1][0] as string);
    expect(calledUrl.searchParams.get("server")).toBe("netease");
    expect(calledUrl.searchParams.get("type")).toBe("playlist");
    expect(calledUrl.searchParams.get("id")).toBe("123");
  });

  it("NeteaseCloudMusicApi 数据源：拉取全量歌单并组装播放列表（无版权歌曲跳过）", async () => {
    fetchMock.mockImplementation((url: string) => {
      const u = new URL(url);
      if (u.pathname.includes("/playlist/track/all")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              songs: [
                { id: 1, name: "歌一", ar: [{ name: "歌手A" }], al: { picUrl: "https://cdn.example.com/1.jpg" } },
                { id: 2, name: "歌二", ar: [{ name: "歌手B" }, { name: "歌手C" }], al: { picUrl: "" } },
              ],
            }),
            { status: 200 }
          )
        );
      }
      if (u.pathname.includes("/song/url/v1")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: [
                { id: 1, url: "https://cdn.example.com/1.mp3" },
                { id: 2, url: null }, // 无版权：无播放地址，应被跳过
              ],
            }),
            { status: 200 }
          )
        );
      }
      return Promise.resolve(new Response("[]", { status: 200 }));
    });

    const res = await GET(
      makeRequest("?api=https://example.com/ncm&server=netease&type=playlist&id=3778678")
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([
      {
        id: "1",
        name: "歌一",
        artist: "歌手A",
        url: "https://cdn.example.com/1.mp3",
        cover: "https://cdn.example.com/1.jpg",
        lrc: "https://example.com/ncm/lyric?id=1",
      },
    ]);
    // 播放地址接口按标准音质请求
    const urlCall = new URL(fetchMock.mock.calls[1][0] as string);
    expect(urlCall.searchParams.get("level")).toBe("standard");
  });

  it("songApi 与后台配置一致时放行私网（自建 NeteaseCloudMusicApi）", async () => {
    // 管理员后台配置了本机自建 API
    const { prisma } = await import("@/lib/db");
    (prisma.profile.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      songApi: "http://127.0.0.1:3000",
    });
    // 每次调用返回新 Response：NCM 歌单为空回退 meting，meting 返回空数组
    fetchMock.mockImplementation((url: string) => {
      const u = new URL(url);
      if (u.pathname.includes("/playlist/track/all")) {
        return Promise.resolve(new Response(JSON.stringify({ songs: [] }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    });

    const res = await GET(
      makeRequest("?api=http://127.0.0.1:3000&server=netease&type=playlist&id=1")
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
    // 私网被放行后真正发起了对白名单 API 的代理请求（而非直接 SSRF 拒绝）
    expect(fetchMock).toHaveBeenCalled();
    const firstUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(firstUrl.origin).toBe("http://127.0.0.1:3000");
    expect(firstUrl.pathname).toContain("/playlist/track/all");
  });

  it("songApi 与后台配置不一致时私网仍被拒绝", async () => {
    const { prisma } = await import("@/lib/db");
    (prisma.profile.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      songApi: "https://music.example.com",
    });

    const res = await GET(
      makeRequest("?api=http://127.0.0.1:3000&server=netease&type=playlist&id=1")
    );
    const body = await res.json();

    expect(body).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("第三方返回 302 重定向到内网时拒绝", async () => {
    // 内网跳转目标故意返回一份**合法歌单**：一旦退化成 redirect:"follow"，
    // 代理会真的把内网内容回传给客户端，用例会立刻失败，而不是静默通过。
    const { fn, requested } = createRedirectAwareFetch((u) => {
      if (u.includes("127.0.0.1")) {
        return new Response(JSON.stringify([{ id: 1, name: "内网内容" }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/steal" } });
    });
    vi.stubGlobal("fetch", fn);

    const res = await GET(
      makeRequest("?api=https://example.com/api&server=netease&type=playlist&id=1")
    );

    expect(await res.json()).toEqual([]);
    // 关键：从未真正请求过内网地址
    expect(requested.every((u) => !u.includes("127.0.0.1"))).toBe(true);
  });

  it("响应体超过大小限制时拒绝并返回示例列表", async () => {
    fetchMock.mockResolvedValue(
      new Response("x", { status: 200, headers: { "content-length": "6000000" } })
    );

    const res = await GET(
      makeRequest("?api=https://example.com/api&server=netease&type=playlist&id=1")
    );
    expect(await res.json()).toEqual([]);
  });

  it("第三方返回非 2xx 时返回示例列表", async () => {
    fetchMock.mockResolvedValue(new Response("oops", { status: 500 }));

    const res = await GET(
      makeRequest("?api=https://example.com/api&server=netease&type=playlist&id=1")
    );
    expect(await res.json()).toEqual([]);
  });
});
