import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { getClientIp, isValidIp } from "@/lib/server";

describe("isValidIp（IPv4/IPv6 校验）", () => {
  it("接受合法 IPv4 / IPv6", () => {
    expect(isValidIp("127.0.0.1")).toBe(true);
    expect(isValidIp("2001:db8::1")).toBe(true);
  });
  it("拒绝越界段、非法字符与超长", () => {
    expect(isValidIp("999.1.1.1")).toBe(false);
    expect(isValidIp("evil<script>")).toBe(false);
    expect(isValidIp("a".repeat(100))).toBe(false);
  });
  it("空值返回 false", () => {
    expect(isValidIp("")).toBe(false);
  });
  it("拒绝不含冒号的十六进制文本（此前会被当成 IPv6）", () => {
    expect(isValidIp("cafebabe")).toBe(false);
    expect(isValidIp("deadbeef")).toBe(false);
  });
  it("IPv6 分组数与压缩写法校验", () => {
    expect(isValidIp("::1")).toBe(true);
    expect(isValidIp("::")).toBe(true);
    expect(isValidIp("2001:db8::1")).toBe(true);
    expect(isValidIp("1:2:3:4:5:6:7:8")).toBe(true);
    expect(isValidIp("1:2:3:4:5:6:7:8:9")).toBe(false); // 超过 8 组
    expect(isValidIp("1:2:3:4:5:6:7:8:")).toBe(false);
    expect(isValidIp("2001:db8::1::2")).toBe(false); // "::" 出现两次
    expect(isValidIp("12345::1")).toBe(false); // 单组超 4 位
  });
});

describe("getClientIp（来自请求头，非法被丢弃）", () => {
  it("合法 x-forwarded-for 取第一个值", () => {
    const req = new NextRequest("http://localhost/api/x", {
      headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" },
    });
    expect(getClientIp(req)).toBe("203.0.113.5");
  });
  it("非法 x-forwarded-for 回退 x-real-ip", () => {
    const req = new NextRequest("http://localhost/api/x", {
      headers: { "x-forwarded-for": "not-an-ip", "x-real-ip": "198.51.100.7" },
    });
    expect(getClientIp(req)).toBe("198.51.100.7");
  });
  it("全部非法时返回空串", () => {
    const req = new NextRequest("http://localhost/api/x", {
      headers: { "x-forwarded-for": "hacker" },
    });
    expect(getClientIp(req)).toBe("");
  });
});