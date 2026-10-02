import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * GET /api/icons 读取上游目录时的响应体上限。
 *
 * 背景：原实现直接 `await response.json()`，会把上游响应体整个读进内存再做校验，
 * 上游异常（或被篡改）返回超大响应时可能撑爆服务。同项目的 /api/music 早已有
 * 5MB 的读取上限，这里对齐。
 *
 * 注意：路由内按 prefix 缓存 1 小时，故各用例必须使用不同的 prefix，避免互相命中缓存。
 */

const fetchSafe = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: { profile: { findFirst: vi.fn(async () => null) } },
}));

vi.mock("next-auth", () => ({
  getSession: vi.fn(async () => ({ user: { name: "admin" } })),
  getServerSession: vi.fn(async () => ({ user: { name: "admin" } })),
}));

vi.mock("@/lib/ssrf", () => ({
  UnsafeUrlError: class UnsafeUrlError extends Error {},
  fetchFollowingSafeRedirects: (...args: unknown[]) => fetchSafe(...args),
}));

process.env.NEXTAUTH_SECRET = "test-secret-for-icons-catalog-limit-0123456789abcdef";

const { GET } = await import("@/app/api/icons/route");

/** 上游目录响应体上限（与路由内常量保持一致：8MB） */
const CATALOG_LIMIT_BYTES = 8 * 1024 * 1024;

function catalogRequest(prefix: string) {
  return new NextRequest(`http://localhost/api/icons?prefix=${prefix}`);
}

/** 让被 mock 的上游返回指定响应体 */
function upstreamReturns(body: string) {
  fetchSafe.mockResolvedValueOnce({ response: new Response(body, { status: 200 }) });
}

describe("GET /api/icons（上游响应体大小上限）", () => {
  beforeEach(() => {
    fetchSafe.mockReset();
  });

  it("正常目录：解析出图标列表与分类统计", async () => {
    upstreamReturns(
      JSON.stringify({
        prefix: "okset",
        title: "正常图标集",
        uncategorized: ["alpha", "beta"],
        categories: { 常用: ["gamma"] },
      })
    );

    const res = await GET(catalogRequest("okset"));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { title: string; total: number; icons: { name: string }[] };
    expect(json.title).toBe("正常图标集");
    expect(json.total).toBe(3);
    expect(json.icons.map((i) => i.name)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("上游响应体超过上限时拒绝，而不是把整个响应体读进内存", async () => {
    upstreamReturns("x".repeat(CATALOG_LIMIT_BYTES + 1));

    const res = await GET(catalogRequest("hugeset"));
    expect(res.status, "超大响应体被当成正常目录返回了").toBe(400);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toContain("过大");
  });

  it("上游返回非 JSON 时给出错误响应，而不是 200", async () => {
    upstreamReturns("<html>upstream error page</html>");

    const res = await GET(catalogRequest("notjson"));
    expect(res.status).not.toBe(200);
  });
});
