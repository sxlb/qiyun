import { describe, it, expect, vi } from "vitest";
import dns from "node:dns";
import {
  isPrivateAddress,
  isPrivateIPv4,
  assertPublicHttpUrl,
  UnsafeUrlError,
} from "@/lib/ssrf";

describe("isPrivateIPv4（私网/保留 IPv4 地址段）", () => {
  it.each([
    // [地址, 是否私网]
    ["10.0.0.1", true],
    ["10.255.255.255", true],
    ["172.16.0.1", true],
    ["172.31.255.255", true],
    ["172.32.0.1", false], // 172.32/12 之外
    ["192.168.1.1", true],
    ["127.0.0.1", true],
    ["0.0.0.0", true],
    ["169.254.169.254", true], // 云元数据地址
    ["100.64.0.1", true], // CGNAT
    ["224.0.0.1", true], // 组播
    ["240.0.0.1", true], // 保留
    ["255.255.255.255", true],
    ["8.8.8.8", false],
    ["1.1.1.1", false],
  ])("%s → %s", (ip, expected) => {
    expect(isPrivateIPv4(ip)).toBe(expected);
  });

  it("非法格式返回 false", () => {
    expect(isPrivateIPv4("999.1.1.1")).toBe(false);
    expect(isPrivateIPv4("not-an-ip")).toBe(false);
    expect(isPrivateIPv4("")).toBe(false);
  });
});

describe("isPrivateIPv6 / isPrivateAddress（IPv6）", () => {
  it("未指定与环回", () => {
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("::")).toBe(true);
  });

  it("IPv4 映射地址按 IPv4 判断", () => {
    expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateAddress("::ffff:192.168.1.1")).toBe(true);
    expect(isPrivateAddress("::ffff:8.8.8.8")).toBe(false);
  });

  it("ULA / 链路本地 / 组播", () => {
    expect(isPrivateAddress("fc00::1")).toBe(true);
    expect(isPrivateAddress("fd12:3456:7890::1")).toBe(true);
    expect(isPrivateAddress("fe80::1")).toBe(true);
    expect(isPrivateAddress("fe80::1%eth0")).toBe(true); // 带作用域标识
    expect(isPrivateAddress("ff02::1")).toBe(true);
    expect(isPrivateAddress("2001:4860:4860::8888")).toBe(false);
  });
});

describe("assertPublicHttpUrl（SSRF 校验）", () => {
  it("拒绝非 http/https 协议", async () => {
    await expect(assertPublicHttpUrl("file:///etc/passwd")).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(assertPublicHttpUrl("ftp://example.com/x")).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(assertPublicHttpUrl("javascript:alert(1)")).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("拒绝私网字面量 IP（含内网服务与云元数据）", async () => {
    await expect(assertPublicHttpUrl("http://127.0.0.1:3000/x")).rejects.toThrow(/内网|保留/);
    await expect(assertPublicHttpUrl("http://192.168.1.1/api")).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(assertPublicHttpUrl("http://169.254.169.254/latest/meta-data")).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(assertPublicHttpUrl("http://[::1]:8080/")).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("域名解析到私网 IP 时拒绝（防 DNS rebinding）", async () => {
    const spy = vi
      .spyOn(dns.promises, "lookup")
      .mockResolvedValue([{ address: "10.0.0.5", family: 4 }] as any);

    await expect(assertPublicHttpUrl("http://evil.example.com/x")).rejects.toThrow(/解析到内网/);
    spy.mockRestore();
  });

  it("域名多记录中任一为私网即拒绝", async () => {
    const spy = vi.spyOn(dns.promises, "lookup").mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "10.1.2.3", family: 4 },
    ] as any);

    await expect(assertPublicHttpUrl("http://mix.example.com/x")).rejects.toBeInstanceOf(UnsafeUrlError);
    spy.mockRestore();
  });

  it("DNS 解析失败时拒绝（无法确认安全性）", async () => {
    const spy = vi
      .spyOn(dns.promises, "lookup")
      .mockRejectedValue(new Error("ENOTFOUND"));

    await expect(assertPublicHttpUrl("http://no-such-host.invalid/x")).rejects.toBeInstanceOf(UnsafeUrlError);
    spy.mockRestore();
  });

  it("公网域名解析全部为公网时通过", async () => {
    const spy = vi.spyOn(dns.promises, "lookup").mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1::a", family: 6 },
    ] as any);

    const url = await assertPublicHttpUrl("https://example.com/playlist?id=1");
    expect(url.hostname).toBe("example.com");
    spy.mockRestore();
  });

  it("公网字面量 IP 直接通过（无需 DNS）", async () => {
    const spy = vi.spyOn(dns.promises, "lookup");
    const url = await assertPublicHttpUrl("http://93.184.216.34:8080/api");
    expect(url.hostname).toBe("93.184.216.34");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
