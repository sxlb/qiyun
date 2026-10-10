import { describe, it, expect, vi, beforeEach } from "vitest";
import dns from "node:dns";
import { NextRequest } from "next/server";
import { createRedirectAwareFetch } from "../helpers/redirect-aware-fetch";

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

/**
 * 网易云官方 API 直连（music.163.com/api）。
 *
 * 背景：后台「选择 API 源」里有「网易云官方 API（直连）」这一项，但官方接口的路径
 * 与开源 NeteaseCloudMusicApi 完全不同（官方没有 /playlist/track/all 与 /song/url/v1），
 * 此前会被拼成不存在的地址，歌单恒为空 —— 前台于是提示「尚未配置音乐歌单」，
 * 而站主明明已经配置过了。
 *
 * 这里锁住官方分支的三步链路（歌单 → 歌曲信息 → 播放地址）、字段组装，
 * 以及「无版权曲目跳过」与「不再回退到开源路径」两条行为。
 */
describe("网易云官方 API 直连", () => {
  const fetchMock = vi.fn();

  const DETAIL = { playlist: { trackIds: [{ id: 101 }, { id: 102 }, { id: 103 }] } };
  const SONGS = {
    songs: [
      { id: 101, name: "免费歌", ar: [{ name: "歌手A" }], al: { picUrl: "https://cdn/101.jpg" } },
      { id: 102, name: "VIP歌", ar: [{ name: "歌手B" }], al: { picUrl: "https://cdn/102.jpg" } },
      { id: 103, name: "另一首", ar: [{ name: "歌手C" }], al: { picUrl: "https://cdn/103.jpg" } },
    ],
  };
  // 官方对 VIP / 无版权曲目返回 url: null（不是报错，跳过即可）
  const URLS = {
    data: [
      { id: 101, url: "https://cdn/101.mp3" },
      { id: 102, url: null },
      { id: 103, url: "https://cdn/103.mp3" },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    // music.163.com 必须解析到公网 IP 才会被 SSRF 校验放行
    vi.spyOn(dns.promises, "lookup").mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ] as never);
  });

  /** 按官方端点分发响应 */
  function stubOfficial(): void {
    fetchMock.mockImplementation((url: string) => {
      const u = new URL(url);
      if (u.pathname.endsWith("/v6/playlist/detail")) {
        return Promise.resolve(new Response(JSON.stringify(DETAIL), { status: 200 }));
      }
      if (u.pathname.endsWith("/song/detail")) {
        return Promise.resolve(new Response(JSON.stringify(SONGS), { status: 200 }));
      }
      if (u.pathname.endsWith("/song/enhance/player/url")) {
        return Promise.resolve(new Response(JSON.stringify(URLS), { status: 200 }));
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
  }

  it("按官方路径取歌单与播放地址，无版权曲目跳过", async () => {
    stubOfficial();

    const res = await GET(
      makeRequest("?api=https://music.163.com/api&server=netease&type=playlist&id=3778678")
    );

    expect(await res.json()).toEqual([
      {
        id: "101",
        name: "免费歌",
        artist: "歌手A",
        url: "https://cdn/101.mp3",
        cover: "https://cdn/101.jpg",
        lrc: "https://music.163.com/api/song/lyric?id=101&lv=1&kv=1&tv=-1",
      },
      {
        id: "103",
        name: "另一首",
        artist: "歌手C",
        url: "https://cdn/103.mp3",
        cover: "https://cdn/103.jpg",
        lrc: "https://music.163.com/api/song/lyric?id=103&lv=1&kv=1&tv=-1",
      },
    ]);
  });

  it("命中官方主机后不再尝试开源实现的两条路径（它们对官方域名必然 404）", async () => {
    stubOfficial();

    await GET(makeRequest("?api=https://music.163.com/api&server=netease&type=playlist&id=1"));

    const paths = fetchMock.mock.calls.map((c) => new URL(c[0] as string).pathname);
    expect(paths.some((p) => p.includes("/playlist/track/all"))).toBe(false);
    expect(paths.some((p) => p.includes("/song/url"))).toBe(false);
  });

  it("只填 https://music.163.com（不带 /api）也能拼出正确路径", async () => {
    stubOfficial();

    await GET(makeRequest("?api=https://music.163.com&server=netease&type=playlist&id=1"));

    const first = new URL(fetchMock.mock.calls[0][0] as string);
    expect(first.pathname).toBe("/api/v6/playlist/detail");
  });

  it("歌单不存在（官方返回业务错误对象）返回空列表", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ code: 404, message: "接口未找到！" }), { status: 200 })
      )
    );

    const res = await GET(
      makeRequest("?api=https://music.163.com/api&server=netease&type=playlist&id=999")
    );

    expect(await res.json()).toEqual([]);
  });

  it("歌曲信息接口失败时仍能播放，歌名兜底而不是整单丢弃", async () => {
    fetchMock.mockImplementation((url: string) => {
      const u = new URL(url);
      if (u.pathname.endsWith("/v6/playlist/detail")) {
        return Promise.resolve(
          new Response(JSON.stringify({ playlist: { trackIds: [{ id: 7 }] } }), { status: 200 })
        );
      }
      if (u.pathname.endsWith("/song/detail")) {
        return Promise.resolve(new Response("boom", { status: 500 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ data: [{ id: 7, url: "https://cdn/7.mp3" }] }), {
          status: 200,
        })
      );
    });

    const res = await GET(
      makeRequest("?api=https://music.163.com/api&server=netease&type=playlist&id=1")
    );
    const body = await res.json();

    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      id: "7",
      name: "未知歌曲",
      artist: "未知歌手",
      url: "https://cdn/7.mp3",
    });
  });
});

/**
 * 账户 Cookie 透传与 QQ 音乐官方直连。
 *
 * QQ 音乐与网易云的关键差别：**未登录时官方不给任何播放地址**（结果码 104003），
 * 只有带上站主的 Cookie 才取得到 purl。这里锁住 Cookie 的透传方式（请求头）、
 * 从 Cookie 解析 uin、地址拼接，以及「不填 Cookie 就一首也播不了」这条真实行为。
 */
describe("音乐账户 Cookie 与 QQ 音乐直连", () => {
  const fetchMock = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(dns.promises, "lookup").mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ] as never);
    const { prisma } = await import("@/lib/db");
    (prisma.profile.findFirst as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue(null);
  });

  /** 让后台配置查询返回给定 profile */
  async function withProfile(profile: Record<string, unknown>): Promise<void> {
    const { prisma } = await import("@/lib/db");
    (prisma.profile.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(profile);
  }

  /** 取出某次上游请求带的 Cookie */
  function cookieOf(call: unknown[]): string | undefined {
    const init = call[1] as RequestInit | undefined;
    return (init?.headers as Record<string, string> | undefined)?.Cookie;
  }

  it("网易云官方直连把账户 Cookie 透传给每一个上游请求", async () => {
    await withProfile({
      songApi: "https://music.163.com/api",
      songCookieNetease: "MUSIC_U=abc123",
    });
    fetchMock.mockImplementation((url: string) => {
      const u = new URL(url);
      if (u.pathname.endsWith("/v6/playlist/detail")) {
        return Promise.resolve(
          new Response(JSON.stringify({ playlist: { trackIds: [{ id: 1 }] } }), { status: 200 })
        );
      }
      if (u.pathname.endsWith("/song/enhance/player/url")) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: [{ id: 1, url: "https://cdn/1.mp3" }] }), {
            status: 200,
          })
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ songs: [{ id: 1, name: "VIP 歌" }] }), { status: 200 })
      );
    });

    const res = await GET(
      makeRequest("?api=https://music.163.com/api&server=netease&type=playlist&id=1")
    );
    expect(await res.json()).toHaveLength(1);

    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
    for (const call of fetchMock.mock.calls) {
      expect(cookieOf(call)).toBe("MUSIC_U=abc123");
    }
  });

  it("未配置 Cookie 时不带 Cookie 头（不凭空发凭据）", async () => {
    await withProfile({ songApi: "https://music.163.com/api", songCookieNetease: "" });
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ code: 404 }), { status: 200 }))
    );

    await GET(makeRequest("?api=https://music.163.com/api&server=netease&type=playlist&id=1"));

    expect(fetchMock.mock.calls.some((c) => cookieOf(c))).toBe(false);
  });

  it("QQ 音乐官方链路：歌单 → vkey → 拼出完整播放地址，无版权的跳过", async () => {
    await withProfile({
      songApi: "https://y.qq.com",
      songCookieTencent: "uin=12345; qm_keyst=xyz",
    });

    fetchMock.mockImplementation((url: string) => {
      const u = new URL(url);
      if (u.pathname.includes("fcg_ucc_getcdinfo_byids_cp")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              code: 0,
              cdlist: [
                {
                  songlist: [
                    { songmid: "AAA", songname: "QQ 歌一", singer: [{ name: "歌手Q" }], albummid: "ALB1" },
                    { songmid: "BBB", songname: "QQ 歌二", singer: [{ name: "歌手W" }], albummid: "ALB2" },
                  ],
                },
              ],
            }),
            { status: 200 }
          )
        );
      }
      if (u.pathname.includes("musicu.fcg")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              req_0: {
                code: 0,
                data: {
                  sip: ["http://dl.stream.qqmusic.qq.com/"],
                  midurlinfo: [
                    { songmid: "AAA", purl: "M500AAA.mp3?vkey=v1" },
                    // 无版权 / 未授权：官方不给 purl
                    { songmid: "BBB", purl: "" },
                  ],
                },
              },
            }),
            { status: 200 }
          )
        );
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    });

    const res = await GET(
      makeRequest("?api=https://y.qq.com&server=tencent&type=playlist&id=7011264340")
    );

    expect(await res.json()).toEqual([
      {
        id: "AAA",
        name: "QQ 歌一",
        artist: "歌手Q",
        url: "http://dl.stream.qqmusic.qq.com/M500AAA.mp3?vkey=v1",
        cover: "https://y.qq.com/music/photo_new/T002R300x300M000ALB1.jpg",
        lrc: "",
      },
    ]);

    // vkey 请求要带上从 Cookie 解析出的 uin，否则官方按未登录处理、purl 全空
    const vkeyCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("musicu.fcg"));
    expect(vkeyCall, "未发出 vkey 请求").toBeDefined();
    const data = new URL(String(vkeyCall![0])).searchParams.get("data") ?? "";
    expect(JSON.parse(data).req_0.param.uin).toBe("12345");
  });

  it("QQ 音乐未填 Cookie 时一首也取不到（官方不给 purl）", async () => {
    await withProfile({ songApi: "https://y.qq.com", songCookieTencent: "" });

    fetchMock.mockImplementation((url: string) => {
      const u = new URL(url);
      if (u.pathname.includes("fcg_ucc_getcdinfo_byids_cp")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ code: 0, cdlist: [{ songlist: [{ songmid: "AAA", songname: "歌" }] }] }),
            { status: 200 }
          )
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            req_0: { code: 0, data: { sip: ["http://dl/"], midurlinfo: [{ songmid: "AAA", purl: "" }] } },
          }),
          { status: 200 }
        )
      );
    });

    const res = await GET(makeRequest("?api=https://y.qq.com&server=tencent&type=playlist&id=1"));

    expect(await res.json()).toEqual([]);
  });

  it("歌单取不到时回退到榜单接口（disstid 为空再试 topid）", async () => {
    await withProfile({ songApi: "https://y.qq.com", songCookieTencent: "uin=1; qm_keyst=k" });

    fetchMock.mockImplementation((url: string) => {
      const u = new URL(url);
      if (u.pathname.includes("fcg_ucc_getcdinfo_byids_cp")) {
        return Promise.resolve(
          new Response(JSON.stringify({ code: 0, cdlist: [{ songlist: [] }] }), { status: 200 })
        );
      }
      if (u.pathname.includes("fcg_v8_toplist_cp")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              code: 0,
              songlist: [{ data: { songmid: "TOP1", songname: "榜首歌", singer: [{ name: "榜霸" }] } }],
            }),
            { status: 200 }
          )
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            req_0: { code: 0, data: { sip: ["http://dl/"], midurlinfo: [{ songmid: "TOP1", purl: "top.mp3" }] } },
          }),
          { status: 200 }
        )
      );
    });

    const res = await GET(makeRequest("?api=https://y.qq.com&server=tencent&type=playlist&id=26"));
    const body = await res.json();

    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ id: "TOP1", name: "榜首歌", url: "http://dl/top.mp3" });
  });
});
