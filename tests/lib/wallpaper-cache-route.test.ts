import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * 壁纸缓存管理接口的契约。
 *
 * 最要紧的一条是清空的安全约束：必须显式传 `all=1`。否则任何一次「少带了 fileName 的
 * 请求」（手滑、脚本写错、前端漏参数）都会把用户的壁纸缓存清空，而清空是不可撤销的。
 */

const listMock = vi.fn(async (): Promise<Record<string, unknown>> => ({
  items: [],
  total: 0,
  bytes: 0,
  max: 100,
}));
const deleteMock = vi.fn(async () => true);
const clearMock = vi.fn(async () => 3);
const opLogMock = vi.fn(async () => ({}));

/**
 * 会话状态由测试直接改写：next-auth 的真实模块并不导出 getSession/getServerSession，
 * 从 "next-auth" import 它们会类型报错，所以这里用一个可变的 holder 注入。
 */
const sessionHolder = vi.hoisted(() => ({
  value: { user: { name: "admin" } } as unknown,
}));

vi.mock("@/lib/wallpaperCache", () => ({
  listCachedWallpapers: () => listMock(),
  deleteCachedWallpaper: () => deleteMock(),
  clearWallpaperCache: () => clearMock(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { operationLog: { create: () => opLogMock() } },
}));

vi.mock("next-auth", () => ({
  getSession: vi.fn(async () => sessionHolder.value),
  getServerSession: vi.fn(async () => sessionHolder.value),
}));

// requireSession 会校验密钥长度（不足 32 字符直接抛错）：必须自带一个足够长的密钥，
// 否则「未登录」用例会因为拿到 500 而假通过
process.env.NEXTAUTH_SECRET = "test-secret-for-wallpaper-cache-route-0123456789abcdef";

const { GET, DELETE } = await import("@/app/api/wallpaper/cache/route");

function deleteRequest(query = ""): NextRequest {
  return new NextRequest(`http://localhost/api/wallpaper/cache${query}`, { method: "DELETE" });
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionHolder.value = { user: { name: "admin" } };
  listMock.mockResolvedValue({ items: [], total: 0, bytes: 0, max: 100 });
  deleteMock.mockResolvedValue(true);
  clearMock.mockResolvedValue(3);
});

describe("GET /api/wallpaper/cache", () => {
  it("未登录返回 401，且不读取缓存", async () => {
    sessionHolder.value = null;

    const res = await GET();

    expect(res.status).toBe(401);
    expect(listMock).not.toHaveBeenCalled();
  });

  it("返回缓存清单与占用", async () => {
    listMock.mockResolvedValueOnce({
      items: [
        {
          fileName: "a.webp",
          url: "/api/wallpaper/file/a.webp",
          sourceUrl: "https://example.com/a.webp",
          addedAt: 1,
          size: 10,
          tag: "anime:pc",
          exists: true,
        },
      ],
      total: 1,
      bytes: 10,
      max: 100,
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.max).toBe(100);
    expect(body.items[0]).toMatchObject({ fileName: "a.webp", exists: true });
  });
});

describe("DELETE /api/wallpaper/cache", () => {
  it("未登录返回 401，且不删任何东西", async () => {
    sessionHolder.value = null;

    const res = await DELETE(deleteRequest("?fileName=a.webp"));

    expect(res.status).toBe(401);
    expect(deleteMock).not.toHaveBeenCalled();
    expect(clearMock).not.toHaveBeenCalled();
  });

  it("按 fileName 删单张，命中返回 removed=1", async () => {
    const res = await DELETE(deleteRequest("?fileName=a.webp"));

    expect(res.status).toBe(200);
    expect((await res.json()).removed).toBe(1);
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(clearMock).not.toHaveBeenCalled();
  });

  it("缓存中没有该文件时返回 404", async () => {
    deleteMock.mockResolvedValueOnce(false);

    const res = await DELETE(deleteRequest("?fileName=none.webp"));

    expect(res.status).toBe(404);
  });

  it("既没有 fileName 也没有 all=1 → 400，绝不退化成清空", async () => {
    const res = await DELETE(deleteRequest());

    expect(res.status).toBe(400);
    expect(clearMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("all 取非 1 的值同样不清空", async () => {
    const res = await DELETE(deleteRequest("?all=0"));

    expect(res.status).toBe(400);
    expect(clearMock).not.toHaveBeenCalled();
  });

  it("all=1 时清空并返回删除数量", async () => {
    clearMock.mockResolvedValueOnce(7);

    const res = await DELETE(deleteRequest("?all=1"));

    expect(res.status).toBe(200);
    expect((await res.json()).removed).toBe(7);
    expect(deleteMock).not.toHaveBeenCalled();
  });
});
