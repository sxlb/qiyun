import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  EXTERNAL_API_DEFAULTS,
  deviceFromUserAgent,
  normalizeWallpaperDevice,
  resolveWallpaperApi,
  wallpaperApiKeys,
} from "@/lib/external-api";

/**
 * 壁纸按设备分流（手机竖图 / 电脑横图）。
 *
 * 回归目标有两个：
 * 1. 上游动漫接口按方向分端点（/pc 横图、/mp 竖图），而内置默认值原先指向竖图端点 /mp，
 *    导致电脑端拿到竖图 —— 默认值必须落在 /pc。
 * 2. 缓存按设备分池后不能串图：手机不得取到电脑的条目。
 */
const fsMock = vi.hoisted(() => ({
  mkdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  rm: vi.fn(),
}));

vi.mock("node:fs", () => ({ promises: fsMock }));

const { cacheTagFor, getRandomCachedWallpaper } = await import("@/lib/wallpaperCache");

/** 让 manifest 读取返回给定条目（其余字段用不到，补齐即可） */
function useManifest(entries: Array<{ fileName: string; tag?: string }>): void {
  fsMock.readFile.mockResolvedValue(
    JSON.stringify({
      entries: entries.map((e, i) => ({
        ...e,
        sourceUrl: "https://example.com/a.jpg",
        addedAt: i,
        size: 1,
      })),
      lastRefreshAt: null,
      lastDownloadAt: null,
    })
  );
}

describe("设备归一化与识别", () => {
  it("只有明确 mobile 才按手机处理，其余一律回落 pc（保持分流前的旧行为）", () => {
    expect(normalizeWallpaperDevice("mobile")).toBe("mobile");
    expect(normalizeWallpaperDevice("pc")).toBe("pc");
    expect(normalizeWallpaperDevice("MOBILE")).toBe("pc");
    expect(normalizeWallpaperDevice("")).toBe("pc");
    expect(normalizeWallpaperDevice(null)).toBe("pc");
    expect(normalizeWallpaperDevice(undefined)).toBe("pc");
  });

  it("UA 识别手机（仅用于 SSR 挑预加载图，猜错由客户端视口纠正）", () => {
    expect(deviceFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe("mobile");
    expect(deviceFromUserAgent("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe("mobile");
    expect(deviceFromUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBe("mobile");
    expect(deviceFromUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/154.0")).toBe("pc");
    expect(deviceFromUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605")).toBe("pc");
    expect(deviceFromUserAgent("")).toBe("pc");
    expect(deviceFromUserAgent(null)).toBe("pc");
  });
});

describe("按设备解析壁纸源", () => {
  it("动漫源默认值落在横图端点 /pc（原先错指竖图端点 /mp）", () => {
    expect(EXTERNAL_API_DEFAULTS.wallpaperAnimeApi).toBe("https://t.mwm.moe/pc");
    expect(EXTERNAL_API_DEFAULTS.wallpaperAnimeApiMobile).toBe("https://t.mwm.moe/mp");
  });

  it("未配置时各自取本设备的内置默认值", () => {
    expect(resolveWallpaperApi({}, "anime", "pc")).toBe(EXTERNAL_API_DEFAULTS.wallpaperAnimeApi);
    expect(resolveWallpaperApi({}, "anime", "mobile")).toBe(
      EXTERNAL_API_DEFAULTS.wallpaperAnimeApiMobile
    );
    expect(resolveWallpaperApi(null, "landscape", "pc")).toBe(
      EXTERNAL_API_DEFAULTS.wallpaperLandscapeApi
    );
  });

  it("配置了本设备地址时优先使用", () => {
    const apis = {
      wallpaperAnimeApi: "https://cdn.example.com/pc",
      wallpaperAnimeApiMobile: "https://cdn.example.com/mobile",
    };
    expect(resolveWallpaperApi(apis, "anime", "pc")).toBe("https://cdn.example.com/pc");
    expect(resolveWallpaperApi(apis, "anime", "mobile")).toBe("https://cdn.example.com/mobile");
  });

  it("手机端未单独配置时沿用电脑端地址，而不是掉回内置默认值", () => {
    const apis = { wallpaperAnimeApi: "https://cdn.example.com/pc" };
    expect(resolveWallpaperApi(apis, "anime", "mobile")).toBe("https://cdn.example.com/pc");
  });

  it("空白字符串视为未配置", () => {
    const apis = { wallpaperLandscapeApiMobile: "   ", wallpaperLandscapeApi: " https://a.example.com " };
    expect(resolveWallpaperApi(apis, "landscape", "mobile")).toBe("https://a.example.com");
  });

  it("候选键：本设备为 primary、另一设备为 fallback", () => {
    expect(wallpaperApiKeys("anime", "pc")).toEqual({
      primary: "wallpaperAnimeApi",
      fallback: "wallpaperAnimeApiMobile",
    });
    expect(wallpaperApiKeys("landscape", "mobile")).toEqual({
      primary: "wallpaperLandscapeApiMobile",
      fallback: "wallpaperLandscapeApi",
    });
  });
});

describe("缓存分池：手机与电脑互不串图", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useManifest([]);
  });

  it("风景 / 动漫按「源 + 设备」分池，必应等与设备无关的源共用 shared 池", () => {
    expect(cacheTagFor("landscape", "mobile")).toBe("landscape:mobile");
    expect(cacheTagFor("landscape", "pc")).toBe("landscape:pc");
    expect(cacheTagFor("anime", "mobile")).toBe("anime:mobile");
    expect(cacheTagFor("anime", "pc")).toBe("anime:pc");
    expect(cacheTagFor("bing", "mobile")).toBe("shared");
    expect(cacheTagFor("bing", "pc")).toBe("shared");
    expect(cacheTagFor("custom", "mobile")).toBe("shared");
    expect(cacheTagFor("", "pc")).toBe("shared");
  });

  it("同一设备下不同来源也必须分池：手机选动漫不会抽到风景端的横图", async () => {
    // 上游没有竖版风景，风景端的手机地址其实就是横图；若与动漫端混池，
    // 手机选「动漫」仍可能拿到横图 —— 这正是要防的
    useManifest([
      { fileName: "fj-landscape.jpg", tag: "landscape:mobile" },
      { fileName: "mp-portrait.jpg", tag: "anime:mobile" },
    ]);
    vi.spyOn(Math, "random").mockReturnValue(0);

    expect(await getRandomCachedWallpaper("anime:mobile")).toBe("mp-portrait.jpg");
    expect(await getRandomCachedWallpaper("landscape:mobile")).toBe("fj-landscape.jpg");
  });

  it("mobile 请求只取 mobile 条目，pc 请求只取 pc 条目", async () => {
    useManifest([
      { fileName: "pc-1.jpg", tag: "anime:pc" },
      { fileName: "mobile-1.jpg", tag: "anime:mobile" },
    ]);
    vi.spyOn(Math, "random").mockReturnValue(0);

    expect(await getRandomCachedWallpaper("anime:mobile")).toBe("mobile-1.jpg");
    expect(await getRandomCachedWallpaper("anime:pc")).toBe("pc-1.jpg");
  });

  it("本池为空时返回 null（宁可让前端重新下载），绝不跨池兜底", async () => {
    useManifest([{ fileName: "pc-1.jpg", tag: "anime:pc" }]);
    expect(await getRandomCachedWallpaper("anime:mobile")).toBeNull();
    // 来源不同同样不兜底
    expect(await getRandomCachedWallpaper("landscape:pc")).toBeNull();
  });

  it("升级前的无标签历史条目只允许 shared 复用", async () => {
    useManifest([{ fileName: "legacy.jpg" }]);
    expect(await getRandomCachedWallpaper("anime:pc")).toBeNull();
    expect(await getRandomCachedWallpaper("anime:mobile")).toBeNull();
    expect(await getRandomCachedWallpaper("shared")).toBe("legacy.jpg");
  });

  it("shared 池有带标签条目时优先用带标签的", async () => {
    useManifest([{ fileName: "legacy.jpg" }, { fileName: "bing.jpg", tag: "shared" }]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(await getRandomCachedWallpaper("shared")).toBe("bing.jpg");
  });

  it("缓存为空时返回 null", async () => {
    useManifest([]);
    expect(await getRandomCachedWallpaper("anime:pc")).toBeNull();
  });
});
