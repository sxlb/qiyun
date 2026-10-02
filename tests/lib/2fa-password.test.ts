import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";

/**
 * POST /api/account/2fa：开启/关闭两步验证必须二次校验当前密码。
 *
 * 背景：此前 setup + enable 全程只需要会话，攻击者一旦拿到会话即可生成并绑定
 * 自己的 TOTP 密钥（持久化 + 把真实管理员锁在门外），与本项目
 * reset-default 的威胁模型（凭据变更需密码）自相矛盾。本文件锁住该不变量。
 */

const PASSWORD = "correct-password-123";

const mocks = {
  findUnique: vi.fn(),
  update: vi.fn(),
  opLogCreate: vi.fn(),
  verifyTOTP: vi.fn(),
};

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mocks.findUnique(...args),
      update: (...args: unknown[]) => mocks.update(...args),
    },
    operationLog: { create: (...args: unknown[]) => mocks.opLogCreate(...args) },
  },
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
  validateAuthEnv: () => {},
  isSessionRevoked: async () => false,
  generateSecret: () => "TESTSECRET234567ABCDEF",
  buildOtpauthUrl: (secret: string) => `otpauth://totp/admin?secret=${secret}`,
  verifyTOTP: (...args: unknown[]) => mocks.verifyTOTP(...args),
  recordFailedAttempt: vi.fn(),
  getLoginRateLimitKey: () => "login-rate-key",
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(() => Promise.resolve({ user: { name: "admin" } })),
}));

process.env.NEXTAUTH_SECRET = "test-secret-for-2fa-0123456789abcdef";

const { POST } = await import("@/app/api/account/2fa/route");

function post(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/account/2fa", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/account/2fa（凭据变更需二次校验密码）", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue({
      id: 1,
      username: "admin",
      // 测试用低轮数哈希，避免拖慢用例
      password: await bcrypt.hash(PASSWORD, 4),
      twoFactorEnabled: false,
      twoFactorSecret: "ABCDEF234567",
    });
    mocks.update.mockResolvedValue({});
    mocks.opLogCreate.mockResolvedValue({});
    mocks.verifyTOTP.mockReturnValue(true);
  });

  it("缺少密码：拒绝，且不写库、不校验验证码", async () => {
    const res = await POST(post({ action: "setup" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("请输入当前密码");
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.verifyTOTP).not.toHaveBeenCalled();
  });

  it("密码错误：403，且不写库、不校验验证码（密码闸门在验证码之前）", async () => {
    const res = await POST(post({ action: "enable", code: "123456", password: "wrong-password" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("当前密码不正确");
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.verifyTOTP).not.toHaveBeenCalled();
  });

  it("密码正确 + setup：返回密钥并写库", async () => {
    const res = await POST(post({ action: "setup", password: PASSWORD }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.secret).toBe("TESTSECRET234567ABCDEF");
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it("密码正确但验证码错误：拒绝，不开启", async () => {
    mocks.verifyTOTP.mockReturnValue(false);
    const res = await POST(post({ action: "enable", code: "000000", password: PASSWORD }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("验证码不正确");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("密码正确 + 验证码正确 + enable：开启成功", async () => {
    const res = await POST(post({ action: "enable", code: "123456", password: PASSWORD }));
    expect(res.status).toBe(200);
    expect((await res.json()).enabled).toBe(true);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { twoFactorEnabled: true },
    });
  });

  it("密码正确 + disable：关闭并清空密钥", async () => {
    mocks.findUnique.mockResolvedValue({
      id: 1,
      username: "admin",
      password: await bcrypt.hash(PASSWORD, 4),
      twoFactorEnabled: true,
      twoFactorSecret: "ABCDEF234567",
    });
    const res = await POST(post({ action: "disable", code: "123456", password: PASSWORD }));
    expect(res.status).toBe(200);
    expect((await res.json()).enabled).toBe(false);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { twoFactorEnabled: false, twoFactorSecret: "" },
    });
  });
});
