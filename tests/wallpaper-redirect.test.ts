import { describe, it, expect, vi, beforeEach } from "vitest";
import dns from "node:dns";
import { createRedirectAwareFetch } from "./helpers/redirect-aware-fetch";

/**
 * 壁纸缓存的出站请求必须逐跳校验 SSRF。
 *
 * 回归目标：`downloadImage` 曾使用 `fetch(..., { redirect: "follow" })`。
 * 该写法会静默跟随 3xx 且不再校验跳转目标，壁纸源一旦（被攻陷或作恶）指向
 * 内网 / 云元数据地址，响应体就会被当成「壁纸」落盘并可通过 /api/wallpaper/file 读回 ——
 * 等于给了一条把内网内容外带的通道。
 */
const fsMock = vi.hoisted(() => ({
  mkdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  rm: vi.fn(),
}));

vi.mock("node:fs", () => ({ promises: fsMock }));

const { downloadAndCacheWallpaper } = await import("@/lib/wallpaperCache");

const SRC = "https://cdn.example.com/a.jpg";
const CDN = "https://img.example.com/real.jpg";
/** 合法 JPEG 头部（magic number 校验需要前 3 字节为 FF D8 FF） */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

function jpegResponse(): Response {
  return new Response(JPEG, { status: 200, headers: { "content-type": "image/jpeg" } });
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

/**
 * 是否落盘了**图片文件**。
 * manifest.json 是下载节流标记（lastDownloadAt），按设计在失败时也会写入，
 * 因此判断「内网内容有没有被缓存下来」必须排除它。
 */
function wroteImageFile(): boolean {
  return fsMock.writeFile.mock.calls.some((c) => !String(c[0]).endsWith("manifest.json"));
}

describe("壁纸下载的 SSRF 逐跳校验", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  /** fetch 实际请求过的地址（含被自动 follow 到的地址，用于证明「从未请求内网」） */
  let requested: string[];

  /** 装配一个「尊重 redirect 语义」的 fetch 替身 */
  function stubFetch(handler: (url: string) => Response): void {
    const mock = createRedirectAwareFetch(handler);
    fetchMock = mock.fn;
    requested = mock.requested;
    vi.stubGlobal("fetch", fetchMock);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    // readFile 拒绝 → manifest 为空 → 无下载节流，每次用例都走完整下载流程
    fsMock.readFile.mockRejectedValue(new Error("ENOENT"));
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.writeFile.mockResolvedValue(undefined);
    fsMock.rm.mockResolvedValue(undefined);

    // 默认：单次请求即返回合法 JPEG；各用例按需覆盖
    stubFetch(() => jpegResponse());
    // 域名统一解析为公网地址；内网目标用字面量 IP，不依赖 DNS
    vi.spyOn(dns.promises, "lookup").mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
  });

  it("出站请求禁止自动跟随重定向（必须 manual，否则中间地址不会被校验）", async () => {
    await downloadAndCacheWallpaper(SRC);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });

  it("壁纸源 302 到云元数据地址时不跟随，且不缓存任何内容", async () => {
    stubFetch((u) => (u === SRC ? redirect("http://169.254.169.254/latest/meta-data") : jpegResponse()));

    const result = await downloadAndCacheWallpaper(SRC);

    expect(result).toBeNull();
    // 关键断言：无论 fetch 是否会自动跳转，内网地址都不允许被真正请求
    expect(requested.every((u) => !u.includes("169.254.169.254"))).toBe(true);
    expect(wroteImageFile()).toBe(false);
  });

  it("壁纸源 302 到内网私有地址时同样被拦截", async () => {
    stubFetch((u) => (u === SRC ? redirect("http://192.168.1.1/admin.png") : jpegResponse()));

    const result = await downloadAndCacheWallpaper(SRC);

    expect(result).toBeNull();
    expect(requested.every((u) => !u.includes("192.168.1.1"))).toBe(true);
    expect(wroteImageFile()).toBe(false);
  });

  it("重定向到公网地址时正常跟随并写入缓存", async () => {
    stubFetch((u) => {
      if (u === SRC) return redirect(CDN);
      if (u === CDN) return jpegResponse();
      return new Response(null, { status: 404 });
    });

    const fileName = await downloadAndCacheWallpaper(SRC);

    expect(fileName).toMatch(/\.jpg$/);
    expect(requested).toContain(CDN);
    const writtenPaths = fsMock.writeFile.mock.calls.map((c) => String(c[0]));
    expect(writtenPaths.some((p) => p.endsWith(fileName!))).toBe(true);
  });

  it("重定向次数超过上限时放弃下载，不落盘", async () => {
    let n = 0;
    stubFetch(() => redirect(`https://loop.example.com/${++n}`));

    const result = await downloadAndCacheWallpaper(SRC);

    expect(result).toBeNull();
    expect(wroteImageFile()).toBe(false);
  });

  it("起始地址本身是内网时直接拒绝，不发起请求", async () => {
    stubFetch(() => jpegResponse());

    const result = await downloadAndCacheWallpaper("http://127.0.0.1:8080/secret.png");

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
