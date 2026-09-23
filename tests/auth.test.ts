import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  authOptions,
  checkRateLimit,
  recordFailedAttempt,
  getLoginRateLimitKey,
  resetLoginRateLimit,
} from "@/lib/auth";

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
    // setup.ts 已统一设置 NEXTAUTH_SECRET，此处断言有意义（避免两边都是 undefined 恒真）
    expect(authOptions.secret).toBe("test-secret-0123456789abcdef");
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
