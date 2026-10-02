import { describe, it, expect, afterEach } from "vitest";
import { hashIp } from "@/lib/visitor-ip";

/**
 * 【VULN-04】访客 IP 脱敏哈希的单元测试。
 * 样本一律使用 RFC 5737 文档专用网段（203.0.113.0/24），不涉及真实用户数据。
 */
describe("hashIp（访客 IP 脱敏哈希）", () => {
  const ORIGINAL_SECRET = process.env.NEXTAUTH_SECRET;

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.NEXTAUTH_SECRET;
    else process.env.NEXTAUTH_SECRET = ORIGINAL_SECRET;
  });

  it("同一 IP 稳定得到同一哈希（独立访客去重的前提）", () => {
    expect(hashIp("203.0.113.7")).toBe(hashIp("203.0.113.7"));
  });

  it("不同 IP 得到不同哈希", () => {
    expect(hashIp("203.0.113.7")).not.toBe(hashIp("203.0.113.8"));
  });

  it("空值 / 纯空白 → 空字符串（调用方据此跳过写入）", () => {
    expect(hashIp("")).toBe("");
    expect(hashIp("   ")).toBe("");
  });

  it("输出为 32 位 hex，且不含原始 IP 明文", () => {
    const h = hashIp("203.0.113.7");
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    expect(h).not.toContain("203.0.113.7");
  });

  it("密钥变化后哈希随之变化（避免跨部署哈希比对还原出 IP）", () => {
    process.env.NEXTAUTH_SECRET = "secret-a-0123456789abcdefghij";
    const a = hashIp("203.0.113.7");
    process.env.NEXTAUTH_SECRET = "secret-b-0123456789abcdefghij";
    const b = hashIp("203.0.113.7");
    expect(a).not.toBe(b);
  });

  it("IPv6 同样可用（长度与格式一致）", () => {
    expect(hashIp("2001:db8::1")).toMatch(/^[0-9a-f]{32}$/);
  });
});
