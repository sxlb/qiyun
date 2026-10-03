import { describe, it, expect, beforeEach, vi, afterEach, type MockedFunction } from "vitest";
import {
  authOptions,
  checkRateLimit,
  recordFailedAttempt,
  getLoginRateLimitKey,
  resetLoginRateLimit,
} from "@/lib/auth";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";

// authorize 的依赖打桩：数据库查询与密码比对，避免真实 IO 与真实哈希开销。
// 本文件其余用例只测纯函数，不受影响。
vi.mock("@/lib/db", () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));
vi.mock("bcryptjs", () => ({
  default: { compare: vi.fn(), hash: vi.fn() },
}));
// 登录成功后会 fire-and-forget 地刷新版本缓存（内部会出网访问 GitHub）；
// 打桩为 no-op，保证用例不外联、可离线稳定运行。
vi.mock("@/lib/version", () => ({
  refreshVersionCacheOnLogin: vi.fn().mockResolvedValue(undefined),
}));

describe("authOptions 配置", () => {
  it("session 策略为 jwt", () => {
    expect(authOptions.session?.strategy).toBe("jwt");
  });

  it("登录页指向 /admin/login", () => {
    expect(authOptions.pages?.signIn).toBe("/admin/login");
  });

  it("使用 credentials provider", () => {
    const providers = authOptions.providers;
    expect(providers).toHaveLength(1);
    const provider = providers[0] as { id?: string; name?: string; type?: string };
    // NextAuth 保留 name 的原始大小写
    expect(provider.name).toBe("Credentials");
  });

  it("secret 来自环境变量", () => {
    // setup.ts 已统一设置 NEXTAUTH_SECRET。这里断言「非空 + 与之一致」：
    // 只比环境变量的话，两边同为 undefined 也会通过，等于没测。
    expect(process.env.NEXTAUTH_SECRET).toBeTruthy();
    expect(authOptions.secret).toBe(process.env.NEXTAUTH_SECRET);
  });
});

describe("登录防爆破限流（recordFailedAttempt + checkRateLimit）", () => {
  beforeEach(() => {
    resetLoginRateLimit();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("5 次失败后锁定 10 分钟", () => {
    const key = "login:1.2.3.4";
    for (let i = 0; i < 5; i++) recordFailedAttempt(key);
    const r = checkRateLimit(key);
    expect(r.locked).toBe(true);
    expect(r.remainingMs).toBeGreaterThan(0);
    expect(r.remainingMs).toBeLessThanOrEqual(10 * 60 * 1000);
  });

  it("锁定期间持续拒绝", () => {
    const key = "login:1.2.3.5";
    for (let i = 0; i < 5; i++) recordFailedAttempt(key);
    recordFailedAttempt(key); // 锁定后继续记录不会解锁
    expect(checkRateLimit(key).locked).toBe(true);
  });

  it("不同 IP key 相互隔离（分布式爆破不互相影响）", () => {
    const k1 = "login:1.1.1.1";
    const k2 = "login:2.2.2.2";
    for (let i = 0; i < 5; i++) recordFailedAttempt(k1);
    expect(checkRateLimit(k1).locked).toBe(true);
    expect(checkRateLimit(k2).locked).toBe(false);
    // 未失败的 key 不受影响
    expect(checkRateLimit("login:9.9.9.9").locked).toBe(false);
  });

  it("锁定 10 分钟后自动解锁（窗口过期重置）", () => {
    vi.useFakeTimers();
    const key = "login:1.2.3.6";
    for (let i = 0; i < 5; i++) recordFailedAttempt(key);
    expect(checkRateLimit(key).locked).toBe(true);

    // 快进 11 分钟（超过 LOCK_MS=10 分钟）
    vi.advanceTimersByTime(11 * 60 * 1000);
    expect(checkRateLimit(key).locked).toBe(false);
  });
});

describe("getLoginRateLimitKey（按来源 IP 提取限流 key）", () => {
  it("优先取 x-forwarded-for 首个合法 IP", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" });
    expect(getLoginRateLimitKey(headers)).toBe("login:203.0.113.5");
  });

  it("x-forwarded-for 缺失时回退 x-real-ip（含 IPv6）", () => {
    expect(getLoginRateLimitKey(new Headers({ "x-real-ip": "2001:db8::1" }))).toBe(
      "login:2001:db8::1"
    );
  });

  it("兼容 next-auth authorize 的 Record 形态头对象", () => {
    expect(getLoginRateLimitKey({ "x-forwarded-for": "198.51.100.7" })).toBe(
      "login:198.51.100.7"
    );
  });

  it("无头或非法 IP 回退 unknown（仍共享限流桶）", () => {
    expect(getLoginRateLimitKey(new Headers())).toBe("login:unknown");
    expect(getLoginRateLimitKey(new Headers({ "x-forwarded-for": "not-an-ip" }))).toBe(
      "login:unknown"
    );
    expect(getLoginRateLimitKey(undefined)).toBe("login:unknown");
  });
});

/* ------------------------------------------------------------------ */

type AuthorizeFn = (
  credentials: Record<string, string> | undefined,
  req: { headers: Record<string, string> }
) => Promise<unknown>;

/** 取 Credentials provider 上真正生效的 authorize（next-auth v4 把它挂在 options 上） */
function getAuthorize(): AuthorizeFn {
  const provider = authOptions.providers[0] as unknown as {
    authorize?: AuthorizeFn;
    options?: { authorize?: AuthorizeFn };
  };
  const fn = provider.options?.authorize ?? provider.authorize;
  if (!fn) throw new Error("未找到 credentials provider 的 authorize");
  return fn;
}

const reqFrom = (ip: string) => ({ headers: { "x-forwarded-for": ip } });

type FindUniqueResult = Awaited<ReturnType<typeof prisma.user.findUnique>>;
const asUser = (u: unknown) => u as FindUniqueResult;

// bcrypt.compare 有多重载（含 callback 形式返回 void），vi.mocked 会取到 void 那个签名，
// 直接 mockResolvedValue 会类型不匹配；这里收敛成本用例实际使用的形态。
const compareMock = vi.mocked(bcrypt.compare) as unknown as MockedFunction<
  (password: string, hash: string) => Promise<boolean>
>;

const FAKE_USER = {
  id: 1,
  username: "admin",
  password: "$2a$12$fake-hash-for-testing-only",
  createdAt: new Date(0),
  updatedAt: new Date(0),
  mustChangePassword: false,
  twoFactorSecret: "",
  twoFactorEnabled: false,
  sessionVersion: 0,
};

describe("authorize：账号维度锁定会同步计入来源 IP", () => {
  const authorize = getAuthorize();

  beforeEach(() => {
    resetLoginRateLimit();
    vi.mocked(prisma.user.findUnique).mockResolvedValue(asUser(FAKE_USER));
  });

  it("账号已锁定 + 换 IP：请求被拒，且该 IP 也计入一次失败（累计到阈值即锁定）", async () => {
    // 先用旧出口 IP 把账号维度打到锁定（连续 5 次密码错误）
    compareMock.mockResolvedValue(false);
    for (let i = 0; i < 5; i++) {
      await authorize({ username: "admin", password: "wrong" }, reqFrom("10.0.0.1"));
    }
    expect(checkRateLimit("login:10.0.0.1").locked).toBe(true);

    // 换一个全新的出口 IP，即使密码正确也会因账号维度已锁而被拒
    compareMock.mockResolvedValue(true);
    const result = await authorize({ username: "admin", password: "right" }, reqFrom("10.0.0.2"));
    expect(result).toBeNull();

    // 被拒的这次已计入该 IP：再记 4 次即达到阈值 → 登录页的来源 IP 预检才能给出「已锁定」
    for (let i = 0; i < 4; i++) recordFailedAttempt("login:10.0.0.2");
    expect(checkRateLimit("login:10.0.0.2").locked).toBe(true);
  });

  it("账号未锁定时不额外计入来源 IP（正确密码正常通过，且清空失败计数）", async () => {
    compareMock.mockResolvedValue(true);
    const result = await authorize({ username: "admin", password: "right" }, reqFrom("10.0.0.3"));
    expect(result).not.toBeNull();

    // 成功登录已清空失败计数：再记 4 次仍未达阈值
    for (let i = 0; i < 4; i++) recordFailedAttempt("login:10.0.0.3");
    expect(checkRateLimit("login:10.0.0.3").locked).toBe(false);
  });
});
