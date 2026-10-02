import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import {
  EXTERNAL_API_DEFAULTS,
  fillTemplate,
  joinUrl,
  pickExternalApis,
  resolveExternalApi,
} from "@/lib/external-api";
import { profileSchema } from "@/lib/validation";
import { POST } from "@/app/api/external-apis/test/route";

// vi.mock 会被提升到文件顶部，故用 vi.hoisted 保证 mock 容器先于工厂函数初始化
const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  isRateLimited: vi.fn(),
}));

vi.mock("@/lib/server", () => ({
  requireSession: mocks.requireSession,
  error: (message: string, status = 400) => NextResponse.json({ error: message }, { status }),
  internalError: (message: string) => NextResponse.json({ error: message }, { status: 500 }),
  getClientIp: () => "203.0.113.5",
  parseJsonBody: async (req: Request) => {
    try {
      return await req.json();
    } catch {
      return null;
    }
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  isRateLimited: mocks.isRateLimited,
}));

/* ==================== 纯函数：模板与默认值 ==================== */

describe("fillTemplate（外部服务地址占位符）", () => {
  it("替换 {w}/{h}/{kw} 占位符", () => {
    expect(
      fillTemplate("https://img.example.com/{w}/{h}/{kw}", { w: 60, h: 80, kw: "nature" })
    ).toBe("https://img.example.com/60/80/nature");
  });

  it("关键词做 URI 编码；空关键词回退 random", () => {
    expect(fillTemplate("https://x.com/{kw}", { kw: "city sky" })).toBe("https://x.com/city%20sky");
    expect(fillTemplate("https://x.com/{kw}", { kw: "   " })).toBe("https://x.com/random");
  });

  it("替换 {host} 占位符", () => {
    expect(fillTemplate("https://favicon.im/{host}", { host: "github.com" })).toBe(
      "https://favicon.im/github.com"
    );
  });

  it("未提供的占位符替换为空串，不残留字面量导致 404", () => {
    expect(fillTemplate("https://x.com/{w}/{h}", { w: 100 })).toBe("https://x.com/100/");
  });

  it("无占位符的地址原样返回（含已带查询串的自建接口）", () => {
    expect(fillTemplate("https://t.mwm.moe/fj", {})).toBe("https://t.mwm.moe/fj");
    expect(fillTemplate("https://self.example.com/api?type=fj", { w: 1 })).toBe(
      "https://self.example.com/api?type=fj"
    );
  });
});

describe("resolveExternalApi（未配置时回退内置默认）", () => {
  it("空 / 纯空白 / null 均回退默认地址", () => {
    expect(resolveExternalApi({}, "wallpaperLandscapeApi")).toBe(
      EXTERNAL_API_DEFAULTS.wallpaperLandscapeApi
    );
    expect(resolveExternalApi({ wallpaperLandscapeApi: "   " }, "wallpaperLandscapeApi")).toBe(
      EXTERNAL_API_DEFAULTS.wallpaperLandscapeApi
    );
    expect(resolveExternalApi(null, "iconifyApi")).toBe(EXTERNAL_API_DEFAULTS.iconifyApi);
  });

  it("已配置时优先使用自定义地址", () => {
    expect(resolveExternalApi({ iconifyApi: "https://iconify.example.com" }, "iconifyApi")).toBe(
      "https://iconify.example.com"
    );
  });

  it("faviconApi 内置默认值为空串（表示只用内置多源回退）", () => {
    expect(resolveExternalApi({}, "faviconApi")).toBe("");
  });
});

describe("pickExternalApis（从 Profile 行提取配置）", () => {
  it("提取全部字段，缺失项补空串", () => {
    const picked = pickExternalApis({ iconifyApi: "https://iconify.example.com" });
    expect(picked.iconifyApi).toBe("https://iconify.example.com");
    expect(picked.wallpaperLandscapeApi).toBe("");
    expect(Object.keys(picked)).toHaveLength(Object.keys(EXTERNAL_API_DEFAULTS).length);
  });

  it("入参为 null 时返回空对象", () => {
    expect(pickExternalApis(null)).toEqual({});
  });
});

describe("joinUrl（基地址与子路径拼接）", () => {
  it("规整两侧斜杠，避免出现双斜杠或缺斜杠", () => {
    expect(joinUrl("https://api.iconify.design", "collection")).toBe(
      "https://api.iconify.design/collection"
    );
    expect(joinUrl("https://api.iconify.design/", "/collection")).toBe(
      "https://api.iconify.design/collection"
    );
  });
});

/* ==================== 校验：地址必须为 http(s) ==================== */

describe("profileSchema 对外部服务地址的校验", () => {
  it("允许留空（表示回退内置默认）", () => {
    expect(profileSchema.safeParse({ wallpaperLandscapeApi: "" }).success).toBe(true);
  });

  it("允许带占位符的 http(s) 模板", () => {
    expect(
      profileSchema.safeParse({ faviconApi: "https://favicon.im/{host}" }).success
    ).toBe(true);
  });

  it("拒绝非 http(s) 协议（防 javascript: / file: 注入）", () => {
    expect(profileSchema.safeParse({ wallpaperLandscapeApi: "javascript:alert(1)" }).success).toBe(false);
    expect(profileSchema.safeParse({ iconifyApi: "file:///etc/passwd" }).success).toBe(false);
  });
});

/* ==================== 连通性测试接口：鉴权与 SSRF 防护 ==================== */

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/external-apis/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/external-apis/test（鉴权与 SSRF 防护）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isRateLimited.mockReturnValue(false);
  });

  it("未登录返回 401，不发起任何出站请求", async () => {
    mocks.requireSession.mockResolvedValue(null);
    const res = await POST(makeRequest({ url: "https://example.com" }));
    expect(res.status).toBe(401);
  });

  it("请求体缺少 url 返回 400", async () => {
    mocks.requireSession.mockResolvedValue({ user: { name: "admin" } });
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it("限流命中返回 429", async () => {
    mocks.requireSession.mockResolvedValue({ user: { name: "admin" } });
    mocks.isRateLimited.mockReturnValue(true);
    const res = await POST(makeRequest({ url: "https://example.com" }));
    expect(res.status).toBe(429);
  });

  it("内网地址被 SSRF 校验拒绝（返回 ok:false 而非发起请求）", async () => {
    mocks.requireSession.mockResolvedValue({ user: { name: "admin" } });
    const res = await POST(makeRequest({ url: "http://127.0.0.1:8080/admin" }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; message: string };
    expect(data.ok).toBe(false);
    expect(data.message).toContain("内网");
  });

  it("非 http(s) 协议被拒绝", async () => {
    mocks.requireSession.mockResolvedValue({ user: { name: "admin" } });
    const res = await POST(makeRequest({ url: "file:///etc/passwd" }));
    const data = (await res.json()) as { ok: boolean };
    expect(data.ok).toBe(false);
  });
});
