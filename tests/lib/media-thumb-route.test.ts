import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * 两个取图路由的缩略图分支。
 *
 * 契约：带 ?w=<白名单宽度> 时走缩略图；未带 / 非法宽度 / 生成失败三种情况
 * 一律回退原图。回退必须彻底 —— 生成失败若返回 500，后台整片网格会变破图，
 * 比「稍慢的原图」糟糕得多。
 */

// 泛型签名写在 vi.fn 上：实现体不必声明用不到的参数（否则触发 no-unused-vars），
// 同时 mock.calls 的下标类型也能正确推断出来。
const readUploadMock = vi.fn<(name: string) => Promise<unknown>>(async () => ({
  buffer: Buffer.from([1, 2, 3]),
  contentType: "image/png",
}));
const readCachedMock = vi.fn<(name: string) => Promise<unknown>>(async () => ({
  buffer: Buffer.from([4, 5, 6]),
  contentType: "image/jpeg",
}));
const thumbMock = vi.fn<
  (
    source: string,
    fileName: string,
    width: number,
    load: () => Promise<Buffer | null>
  ) => Promise<Buffer | null>
>(async () => Buffer.from([9, 9, 9]));

vi.mock("@/lib/uploads", () => ({
  readUpload: (name: string) => readUploadMock(name),
}));

vi.mock("@/lib/wallpaperCache", () => ({
  readCachedWallpaper: (name: string) => readCachedMock(name),
}));

vi.mock("@/lib/thumbnails", () => ({
  getOrCreateThumbnail: (
    source: string,
    fileName: string,
    width: number,
    load: () => Promise<Buffer | null>
  ) => thumbMock(source, fileName, width, load),
}));

const uploadsRoute = await import("@/app/api/uploads/file/[name]/route");
const wallpaperRoute = await import("@/app/api/wallpaper/file/[name]/route");

function req(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`);
}

const params = (name: string) => ({ params: Promise.resolve({ name }) });

beforeEach(() => {
  vi.clearAllMocks();
  readUploadMock.mockResolvedValue({ buffer: Buffer.from([1, 2, 3]), contentType: "image/png" });
  readCachedMock.mockResolvedValue({ buffer: Buffer.from([4, 5, 6]), contentType: "image/jpeg" });
  thumbMock.mockResolvedValue(Buffer.from([9, 9, 9]));
});

describe("GET /api/uploads/file/[name]", () => {
  it("带合法 w 时返回 WebP 缩略图", async () => {
    const res = await uploadsRoute.GET(req("/api/uploads/file/a.png?w=320"), params("a.png"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/webp");
    expect(thumbMock).toHaveBeenCalledWith("uploads", "a.png", 320, expect.any(Function));
  });

  it("未带 w 时直接给原图，不碰缩略图", async () => {
    const res = await uploadsRoute.GET(req("/api/uploads/file/a.png"), params("a.png"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(thumbMock).not.toHaveBeenCalled();
  });

  it("w 不在白名单时回退原图（防止被当作放大请求）", async () => {
    const res = await uploadsRoute.GET(req("/api/uploads/file/a.png?w=99999"), params("a.png"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(thumbMock, "非法宽度不该进入缩略图生成").not.toHaveBeenCalled();
  });

  it("缩略图生成失败时回退原图，而不是 500", async () => {
    thumbMock.mockResolvedValueOnce(null);

    const res = await uploadsRoute.GET(req("/api/uploads/file/a.ico?w=320"), params("a.ico"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
  });

  it("文件不存在时返回 404", async () => {
    readUploadMock.mockResolvedValueOnce(null);

    const res = await uploadsRoute.GET(req("/api/uploads/file/none.png"), params("none.png"));

    expect(res.status).toBe(404);
  });
});

describe("GET /api/wallpaper/file/[name]", () => {
  it("带合法 w 时返回 WebP 缩略图", async () => {
    const res = await wallpaperRoute.GET(
      req("/api/wallpaper/file/b.webp?w=640"),
      params("b.webp")
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/webp");
    expect(thumbMock).toHaveBeenCalledWith("wallpaper", "b.webp", 640, expect.any(Function));
  });

  it("未带 w 时直接给原图", async () => {
    const res = await wallpaperRoute.GET(req("/api/wallpaper/file/b.webp"), params("b.webp"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(thumbMock).not.toHaveBeenCalled();
  });

  it("缩略图生成失败时回退原图", async () => {
    thumbMock.mockResolvedValueOnce(null);

    const res = await wallpaperRoute.GET(
      req("/api/wallpaper/file/b.webp?w=320"),
      params("b.webp")
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
  });

  it("懒加载回调能真的取到原图（生成路径与读取路径对得上）", async () => {
    await wallpaperRoute.GET(req("/api/wallpaper/file/b.webp?w=320"), params("b.webp"));

    const load = thumbMock.mock.calls[0][3] as () => Promise<Buffer | null>;
    const buffer = await load();
    expect(buffer).not.toBeNull();
    expect(readCachedMock).toHaveBeenCalledWith("b.webp");
  });
});
