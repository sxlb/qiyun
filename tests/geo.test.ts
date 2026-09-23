import { describe, it, expect } from "vitest";
import { lookupIpRegion, regionLabel, type RegionInfo } from "@/lib/geo";

describe("lookupIpRegion（离线 IP 库解析）", () => {
  it("空串 / 非法输入 → internal", () => {
    expect(lookupIpRegion("").internal).toBe(true);
    expect(lookupIpRegion("   ").internal).toBe(true);
  });

  it("私网/回环/保留地址 → internal（不查库）", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.1", "172.16.0.2", "169.254.0.1", "::1", "fe80::1"]) {
      expect(lookupIpRegion(ip).internal, `${ip} 应判为 internal`).toBe(true);
    }
  });

  it("中国 IP 解析到省/市，国家为中国", () => {
    const r = lookupIpRegion("110.84.0.129"); // 福建·厦门
    expect(r.internal).toBe(false);
    expect(r.country).toBe("中国");
    expect(r.province.length).toBeGreaterThan(0);
  });

  it("美国 IP 解析到国家，internal=false", () => {
    const r = lookupIpRegion("8.8.8.8");
    expect(r.internal).toBe(false);
    expect(r.country).toBe("美国");
  });
});

describe("regionLabel（地域标签）", () => {
  const info: RegionInfo = { country: "中国", province: "江苏省", city: "南京市", internal: false };
  it("国内 → 国家+省+市", () => {
    expect(regionLabel(info)).toBe("中国 江苏省 南京市");
  });
  it("仅国家 → 海外单国家", () => {
    expect(regionLabel({ country: "美国", province: "", city: "", internal: false })).toBe("美国");
  });
  it("internal → 局域网/未知", () => {
    expect(regionLabel({ country: "", province: "", city: "", internal: true })).toBe("局域网/未知");
  });
});