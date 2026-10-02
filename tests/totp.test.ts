import { describe, it, expect, vi } from "vitest";
import { verifyTOTP, generateSecret, buildOtpauthUrl } from "@/lib/auth";

// RFC 6238 附录 B 测试向量：secret = "12345678901234567890"（ASCII）
// base32 = GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ
const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("verifyTOTP（RFC 6238 SHA1 测试向量）", () => {
  const cases: [number, string][] = [
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
    [20000000000, "353130"],
  ];

  for (const [time, code] of cases) {
    it(`时间 ${time} → ${code}`, () => {
      vi.setSystemTime(new Date(time * 1000));
      expect(verifyTOTP(SECRET, code)).toBe(true);
      vi.useRealTimers();
    });
  }

  it("错误验证码返回 false", () => {
    vi.setSystemTime(new Date(59 * 1000));
    expect(verifyTOTP(SECRET, "000000")).toBe(false);
    vi.useRealTimers();
  });

  it("非 6 位数字返回 false", () => {
    expect(verifyTOTP(SECRET, "12345")).toBe(false);
    expect(verifyTOTP(SECRET, "abcdef")).toBe(false);
  });
});

describe("generateSecret / buildOtpauthUrl", () => {
  it("生成 base32 格式 secret", () => {
    const s = generateSecret();
    expect(s).toMatch(/^[A-Z2-7]+$/);
    expect(s.length).toBeGreaterThanOrEqual(26);
  });

  it("生成 otpauth URL", () => {
    expect(buildOtpauthUrl(SECRET, "admin")).toContain("otpauth://totp/admin");
    expect(buildOtpauthUrl(SECRET)).toContain("secret=");
  });
});
