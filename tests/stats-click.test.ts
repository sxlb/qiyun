import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * 点击上报接口（POST /api/stats/click）。
 *
 * 该接口**无鉴权**、任何访客都能直接 POST，因此两条不变量必须有回归护栏：
 * 1. 目标必须真实存在 —— 否则任意 id 都能凭空建行，污染后台「热门链接」并构成写放大；
 * 2. 名称/链接取数据库权威值 —— 请求体里的 name/url 一律不可信（投毒）。
 * 另外 SiteLink / FriendLink / Project 的 id 空间彼此独立，必须用 (kind, linkId) 定位，
 * 否则「作品 #3」的点击会被记到「网站链接 #3」上。
 */
const mockPrisma = {
  project: { findUnique: vi.fn() },
  siteLink: { findUnique: vi.fn() },
  friendLink: { findUnique: vi.fn() },
  siteLinkClick: { upsert: vi.fn() },
};

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const { mockIsRateLimited } = vi.hoisted(() => ({
  // 显式声明签名（而非用具名形参）以保持类型安全，同时避免未使用形参的 lint 告警
  mockIsRateLimited: vi.fn<(key: string, limit: number, windowMs: number) => boolean>(() => false),
}));

vi.mock("@/lib/server", () => ({
  error: (msg: string, status?: number) =>
    new Response(JSON.stringify({ error: msg }), {
      status: status ?? 400,
      headers: { "Content-Type": "application/json" },
    }),
  internalError: (msg: string) =>
    new Response(JSON.stringify({ error: msg }), { status: 500, headers: { "Content-Type": "application/json" } }),
  getClientIp: () => "127.0.0.1",
  isRateLimited: mockIsRateLimited,
  // 串行队列在测试中直接执行
  serialized: <T,>(fn: () => Promise<T>) => fn(),
  parseJsonBody: async <T,>(req: NextRequest): Promise<T | null> => {
    try {
      return (await req.json()) as T;
    } catch {
      return null;
    }
  },
}));

/** 构造上报请求；不传 body 时构造无请求体请求（触发 JSON 解析失败分支） */
function makeRequest(body?: Record<string, unknown>): NextRequest {
  if (body === undefined) {
    return new NextRequest("http://localhost:3000/api/stats/click", { method: "POST" });
  }
  return new NextRequest("http://localhost:3000/api/stats/click", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** 取唯一一次 upsert 的入参 */
function upsertArg() {
  expect(mockPrisma.siteLinkClick.upsert).toHaveBeenCalledTimes(1);
  return mockPrisma.siteLinkClick.upsert.mock.calls[0][0] as {
    where: { kind_linkId: { kind: string; linkId: number } };
    update: Record<string, unknown>;
    create: Record<string, unknown>;
  };
}

describe("POST /api/stats/click（点击上报）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsRateLimited.mockReturnValue(false);
    mockPrisma.project.findUnique.mockResolvedValue(null);
    mockPrisma.siteLink.findUnique.mockResolvedValue(null);
    mockPrisma.friendLink.findUnique.mockResolvedValue(null);
    mockPrisma.siteLinkClick.upsert.mockResolvedValue({});
  });

  it("请求体不是合法 JSON 时返回 400", async () => {
    const { POST } = await import("@/app/api/stats/click/route");

    const res = await POST(makeRequest());

    expect(res.status).toBe(400);
    expect(mockPrisma.siteLinkClick.upsert).not.toHaveBeenCalled();
  });

  it.each([[{}], [{ id: 0 }], [{ id: -3 }], [{ id: 1.5 }], [{ id: "abc" }], [{ id: null }]])(
    "id 非正整数时返回 400 且不写库：%j",
    async (body) => {
      const { POST } = await import("@/app/api/stats/click/route");

      const res = await POST(makeRequest(body as Record<string, unknown>));

      expect(res.status).toBe(400);
      expect(mockPrisma.siteLinkClick.upsert).not.toHaveBeenCalled();
    }
  );

  it("kind 取值非法时返回 400，且不静默归入 site 桶", async () => {
    const { POST } = await import("@/app/api/stats/click/route");

    const res = await POST(makeRequest({ id: 1, kind: "evil" }));

    expect(res.status).toBe(400);
    expect(mockPrisma.siteLinkClick.upsert).not.toHaveBeenCalled();
  });

  it("目标不存在时不写库（任意 id 无法凭空建行）", async () => {
    const { POST } = await import("@/app/api/stats/click/route");

    const res = await POST(makeRequest({ id: 999, kind: "site" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, recorded: false });
    expect(mockPrisma.siteLinkClick.upsert).not.toHaveBeenCalled();
  });

  it("site：命中时用数据库权威 name/url 入库，请求体伪造内容被完全忽略", async () => {
    mockPrisma.siteLink.findUnique.mockResolvedValue({
      name: "官方站点",
      url: "https://real.example.com",
    });
    const { POST } = await import("@/app/api/stats/click/route");

    const res = await POST(
      makeRequest({
        id: 7,
        kind: "site",
        name: "垃圾广告",
        url: "https://spam.example.com",
      })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, recorded: true });

    const arg = upsertArg();
    expect(arg.where).toEqual({ kind_linkId: { kind: "site", linkId: 7 } });
    expect(arg.update).toEqual({
      count: { increment: 1 },
      name: "官方站点",
      url: "https://real.example.com",
    });
    expect(arg.create).toEqual({
      kind: "site",
      linkId: 7,
      name: "官方站点",
      url: "https://real.example.com",
      count: 1,
    });
    // 伪造值绝不能出现在写入参数中
    const serializedArg = JSON.stringify(arg);
    expect(serializedArg).not.toContain("垃圾广告");
    expect(serializedArg).not.toContain("spam.example.com");
  });

  it("project：取 title 作为名称，且与同 id 的网站链接落入不同行（修复计数串台）", async () => {
    mockPrisma.project.findUnique.mockResolvedValue({ title: "作品甲", url: "https://p.example.com" });
    const { POST } = await import("@/app/api/stats/click/route");

    await POST(makeRequest({ id: 7, kind: "project" }));

    const arg = upsertArg();
    expect(arg.where).toEqual({ kind_linkId: { kind: "project", linkId: 7 } });
    expect(arg.create).toMatchObject({ kind: "project", linkId: 7, name: "作品甲" });
    // 关键：与 kind=site、linkId 同为 7 的那一行完全独立
    expect(arg.where.kind_linkId).not.toEqual({ kind: "site", linkId: 7 });
    // 不再去查网站链接表
    expect(mockPrisma.siteLink.findUnique).not.toHaveBeenCalled();
  });

  it("friend：查友情链接表并按 friend 归类", async () => {
    mockPrisma.friendLink.findUnique.mockResolvedValue({ name: "友链乙", url: "https://f.example.com" });
    const { POST } = await import("@/app/api/stats/click/route");

    await POST(makeRequest({ id: 3, kind: "friend" }));

    expect(mockPrisma.friendLink.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 3 } })
    );
    expect(upsertArg().where).toEqual({ kind_linkId: { kind: "friend", linkId: 3 } });
  });

  it("kind=site 未命中时直接丢弃，不会误记到同 id 的友链上", async () => {
    mockPrisma.siteLink.findUnique.mockResolvedValue(null);
    mockPrisma.friendLink.findUnique.mockResolvedValue({ name: "友链乙", url: "https://f.example.com" });
    const { POST } = await import("@/app/api/stats/click/route");

    const res = await POST(makeRequest({ id: 3, kind: "site" }));

    expect((await res.json()).recorded).toBe(false);
    expect(mockPrisma.friendLink.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.siteLinkClick.upsert).not.toHaveBeenCalled();
  });

  it("未带 kind 时按 site 兼容（升级窗口内的旧前端不丢统计）", async () => {
    mockPrisma.siteLink.findUnique.mockResolvedValue({ name: "甲站", url: "https://a.example.com" });
    const { POST } = await import("@/app/api/stats/click/route");

    await POST(makeRequest({ id: 1 }));

    expect(upsertArg().where).toEqual({ kind_linkId: { kind: "site", linkId: 1 } });
  });

  it("限流命中时返回 429 且不写库", async () => {
    mockIsRateLimited.mockReturnValue(true);
    const { POST } = await import("@/app/api/stats/click/route");

    const res = await POST(makeRequest({ id: 1, kind: "site" }));

    expect(res.status).toBe(429);
    expect(mockPrisma.siteLinkClick.upsert).not.toHaveBeenCalled();
  });

  it("limit / windowMs 参数正确（沿用 30 次/分钟防刷）", async () => {
    mockPrisma.siteLink.findUnique.mockResolvedValue({ name: "甲站", url: "https://a.example.com" });
    const { POST } = await import("@/app/api/stats/click/route");

    await POST(makeRequest({ id: 1, kind: "site" }));

    expect(mockIsRateLimited).toHaveBeenCalledWith("click:127.0.0.1", 30, 60_000);
  });
});
