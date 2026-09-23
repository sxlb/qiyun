/** 测试 ResetDefaults API 端点（POST /api/reset-default） */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mock Prisma client & bcrypt
const mockPrisma = {
  $transaction: vi.fn(),
  profile: { findFirst: vi.fn(), create: vi.fn() },
  user: { findUnique: vi.fn() },
  socialLink: { count: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
  siteLink: { count: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
  friendLink: { deleteMany: vi.fn() },
  project: { deleteMany: vi.fn() },
  skill: { deleteMany: vi.fn() },
  siteAnnouncement: { deleteMany: vi.fn() },
  imageAsset: { deleteMany: vi.fn() },
  visitStat: { deleteMany: vi.fn() },
  operationLog: { deleteMany: vi.fn() },
  visitRecord: { deleteMany: vi.fn() },
  siteLinkClick: { deleteMany: vi.fn() },
  updateRecord: { deleteMany: vi.fn() },
};

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const mockBcrypt = {
  hash: vi.fn().mockResolvedValue("hashed_password"),
  compare: vi.fn(),
};
vi.mock("bcryptjs", () => ({ default: mockBcrypt }));

const mockRecordFailedAttempt = vi.fn();
vi.mock("@/lib/auth", () => ({
  recordFailedAttempt: (...args: unknown[]) => mockRecordFailedAttempt(...args),
  getLoginRateLimitKey: () => "login:127.0.0.1",
}));

// 指向不存在的目录：purgeUploadedFiles 会静默返回 0，避免测试触碰真实文件系统
vi.mock("@/lib/uploads", () => ({ getUploadsDir: () => "/nonexistent-uploads-dir-for-test" }));

const writeOperationLogMock = vi.fn();
vi.mock("@/lib/server", () => ({
  requireSession: vi.fn(() => Promise.resolve({ user: { name: "admin" } })),
  error: (msg: string, status?: number) =>
    new Response(JSON.stringify({ error: msg }), {
      status: status ?? 400,
      headers: { "Content-Type": "application/json" },
    }),
  internalError: (msg: string) =>
    new Response(
      JSON.stringify({ error: `${msg}: 服务器内部错误` }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    ),
  getClientIp: vi.fn(() => "127.0.0.1"),
  writeOperationLog: (...args: unknown[]) => writeOperationLogMock(...args),
  parseJsonBody: async <T,>(req: NextRequest): Promise<T | null> => {
    try {
      return (await req.json()) as T;
    } catch {
      return null;
    }
  },
  isRateLimited: vi.fn(() => false),
}));

/** 构造重置请求：body 缺省时不带请求体（用于验证 JSON 解析失败分支） */
function makeRequest(body?: Record<string, unknown>): NextRequest {
  if (body === undefined) {
    return new NextRequest("http://localhost:3000/api/reset-default", { method: "POST" });
  }
  return new NextRequest("http://localhost:3000/api/reset-default", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/reset-default", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认：当前密码校验通过
    mockBcrypt.compare.mockResolvedValue(true);
    mockPrisma.user.findUnique.mockResolvedValue({ id: 1, password: "stored_hash" });
  });

  it("请求体非法 JSON 时返回 400", async () => {
    const { POST } = await import("@/app/api/reset-default/route");
    const res = await POST(makeRequest());
    expect(res.status).toBe(400);
  });

  it("未传 confirm=true 时返回 400", async () => {
    const { POST } = await import("@/app/api/reset-default/route");
    const res = await POST(makeRequest({ password: "secret123" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("确认");
  });

  it("confirm=false 时返回 400", async () => {
    const { POST } = await import("@/app/api/reset-default/route");
    const res = await POST(makeRequest({ confirm: false, password: "secret123" }));
    expect(res.status).toBe(400);
  });

  it("缺少密码时返回 400（危险操作必须二次验证身份）", async () => {
    const { POST } = await import("@/app/api/reset-default/route");
    const res = await POST(makeRequest({ confirm: true }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("密码");
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("密码错误时返回 403，且不执行重置", async () => {
    mockBcrypt.compare.mockResolvedValue(false);
    const { POST } = await import("@/app/api/reset-default/route");
    const res = await POST(makeRequest({ confirm: true, password: "wrong-password" }));
    expect(res.status).toBe(403);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    // 失败计入登录限流，防止用该接口暴力猜解当前密码
    expect(mockRecordFailedAttempt).toHaveBeenCalled();
  });

  it("密码正确时执行清空 + 播种，并写操作日志", async () => {
    const mockTx = {
      visitRecord: { deleteMany: vi.fn(), count: vi.fn().mockResolvedValue(0) },
      siteLinkClick: { deleteMany: vi.fn(), count: vi.fn().mockResolvedValue(0) },
      operationLog: { deleteMany: vi.fn(), count: vi.fn().mockResolvedValue(0) },
      updateRecord: { deleteMany: vi.fn(), count: vi.fn().mockResolvedValue(0) },
      siteAnnouncement: { deleteMany: vi.fn(), count: vi.fn().mockResolvedValue(0) },
      imageAsset: { deleteMany: vi.fn(), count: vi.fn().mockResolvedValue(0) },
      project: { deleteMany: vi.fn(), count: vi.fn().mockResolvedValue(0) },
      skill: { deleteMany: vi.fn(), count: vi.fn().mockResolvedValue(0) },
      friendLink: { deleteMany: vi.fn(), count: vi.fn().mockResolvedValue(0) },
      socialLink: {
        deleteMany: vi.fn(),
        count: vi.fn().mockResolvedValue(5),
        createMany: vi.fn().mockResolvedValue({ count: 5 }),
      },
      siteLink: {
        deleteMany: vi.fn(),
        count: vi.fn().mockResolvedValue(6),
        createMany: vi.fn().mockResolvedValue({ count: 6 }),
      },
      visitStat: { deleteMany: vi.fn(), count: vi.fn().mockResolvedValue(0) },
      profile: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 1 }),
        delete: vi.fn().mockResolvedValue(undefined),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: 1 }),
        update: vi.fn().mockResolvedValue({}),
      },
    };

    mockPrisma.$transaction.mockImplementation(async (cb) => cb(mockTx));

    const { POST } = await import("@/app/api/reset-default/route");
    const res = await POST(makeRequest({ confirm: true, password: "correct-password" }));

    expect(mockPrisma.$transaction).toHaveBeenCalledOnce();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.stats.removedFiles).toBe(0);
    // 播种默认链接
    expect(mockTx.socialLink.createMany).toHaveBeenCalledOnce();
    expect(mockTx.siteLink.createMany).toHaveBeenCalledOnce();
    // 管理员密码被重置并标记强制改密
    expect(mockTx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ mustChangePassword: true }) })
    );
    expect(writeOperationLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        module: "system",
        action: "reset_defaults",
      })
    );
  });
});
