import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET } from "@/app/api/wallpaper/route";

/**
 * /api/wallpaper 的分支契约。
 *
 * 重点是「缓存优先」与「手动换图」这两条路径别接反：
 * - 普通请求：只读缓存，缓存不足才即时下载，绝不会为了取图去打上游（后台才按间隔静默补）；
 * - force=1：明确去上游取一张新的，且只有随机源（风景 / 动漫）才认这个参数 ——
 *   必应当天只有一张图，换了也是同一张；这个公开端点还必须按 IP 限流。
 */

const mocks = vi.hoisted(() => ({
  profileFindFirst: vi.fn(),
  getRandomCachedWallpaper: vi.fn(),
  downloadAndCacheWallpaper: vi.fn(),
  maybePrefetchWallpaper: vi.fn(),
  replaceWallpaper: vi.fn(),
  isRateLimited: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { profile: { findFirst: mocks.profileFindFirst } },
}));

vi.mock("@/lib/wallpaperCache", () => ({
  cacheTagFor: (coverType: string, device: string) =>
    coverType === "landscape" || coverType === "anime" ? `${coverType}:${device}` : "shared",
  getRandomCachedWallpaper: mocks.getRandomCachedWallpaper,
  downloadAndCacheWallpaper: mocks.downloadAndCacheWallpaper,
  maybePrefetchWallpaper: mocks.maybePrefetchWallpaper,
  replaceWallpaper: mocks.replaceWallpaper,
}));

vi.mock("@/lib/server", () => ({
  error: (message: string, status = 400) => NextResponse.json({ error: message }, { status }),
  getClientIp: () => "203.0.113.5",
  isRateLimited: mocks.isRateLimited,
}));

function req(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/wallpaper?${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.profileFindFirst.mockResolvedValue(null);
  mocks.isRateLimited.mockReturnValue(false);
  mocks.getRandomCachedWallpaper.mockResolvedValue("cached.jpg");
  mocks.downloadAndCacheWallpaper.mockResolvedValue("fresh.jpg");
  mocks.replaceWallpaper.mockResolvedValue("switched.jpg");
  mocks.maybePrefetchWallpaper.mockResolvedValue(undefined);
  // 必应分支会解析上游接口，桩掉避免真实出站
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ images: [{ url: "https://bing.example.com/today.jpg" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
    )
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("默认行为：缓存优先", () => {
  it("命中缓存时返回本地地址，并只在后台按间隔补图（不阻塞本次响应）", async () => {
    const res = await GET(req("coverType=landscape&device=pc&refresh=10"));
    const json = await res.json();

    expect(json).toEqual({ url: "/api/wallpaper/file/cached.jpg", cached: true });
    expect(mocks.maybePrefetchWallpaper).toHaveBeenCalledWith(expect.any(String), 10, "landscape:pc");
    // 命中缓存时不该再去下载
    expect(mocks.downloadAndCacheWallpaper).not.toHaveBeenCalled();
  });

  it("缓存为空时才即时下载一张", async () => {
    mocks.getRandomCachedWallpaper.mockResolvedValue(null);

    const json = await (await GET(req("coverType=anime&device=mobile"))).json();

    expect(json).toEqual({ url: "/api/wallpaper/file/fresh.jpg", cached: true });
    expect(mocks.downloadAndCacheWallpaper).toHaveBeenCalledWith(expect.any(String), "anime:mobile");
    expect(mocks.maybePrefetchWallpaper).not.toHaveBeenCalled();
  });

  it("自定义直链直接返回，不碰缓存", async () => {
    const json = await (await GET(req("coverType=custom&bgApi=https%3A%2F%2Fme.example.com%2Fa.jpg"))).json();

    expect(json).toEqual({ url: "https://me.example.com/a.jpg", cached: false });
    expect(mocks.getRandomCachedWallpaper).not.toHaveBeenCalled();
  });
});

describe("force=1：手动换一张", () => {
  it("随机源下明确去上游取新图，并标记 switched", async () => {
    const json = await (await GET(req("coverType=anime&device=pc&force=1"))).json();

    expect(json).toEqual({ url: "/api/wallpaper/file/switched.jpg", cached: true, switched: true });
    expect(mocks.replaceWallpaper).toHaveBeenCalledWith(expect.any(String), "anime:pc");
    // 换图不走「随机取一张已有的」这条路
    expect(mocks.getRandomCachedWallpaper).not.toHaveBeenCalled();
  });

  it("必应不认 force：当天只有一张图，换成普通读缓存", async () => {
    const json = await (await GET(req("coverType=bing&force=1"))).json();

    expect(mocks.replaceWallpaper).not.toHaveBeenCalled();
    expect(json).toEqual({ url: "/api/wallpaper/file/cached.jpg", cached: true });
  });

  it("换图失败时返回空地址，让前端保留当前壁纸", async () => {
    mocks.replaceWallpaper.mockResolvedValue(null);

    const json = await (await GET(req("coverType=landscape&device=pc&force=1"))).json();

    expect(json.url).toBe("");
    expect(json.error).toBeTruthy();
  });

  it("被限流时返回 429，且完全不触发上游下载", async () => {
    mocks.isRateLimited.mockReturnValue(true);

    const res = await GET(req("coverType=anime&device=pc&force=1"));

    expect(res.status).toBe(429);
    expect(mocks.replaceWallpaper).not.toHaveBeenCalled();
    expect(mocks.getRandomCachedWallpaper).not.toHaveBeenCalled();
  });

  it("普通请求不消耗换图限流的额度", async () => {
    await GET(req("coverType=anime&device=pc"));

    expect(mocks.isRateLimited).not.toHaveBeenCalled();
  });
});
