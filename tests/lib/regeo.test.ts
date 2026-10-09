import { describe, expect, it } from "vitest";
import {
  amapLocationParam,
  isUsableAdcode,
  parseAmapRegeo,
  parseCoords,
  parseTencentGeocode,
  tencentLocationParam,
} from "@/lib/regeo";

/**
 * 逆地理编码的纯逻辑层（lib/regeo.ts）。
 *
 * 这一层承载两类最容易出错、又最难在真机上复现的细节：
 * 1. **坐标校验**：浏览器在拿不到定位时可能给出 (0,0)，那是几内亚湾，用它做逆地理编码
 *    既无意义又白费一次出站请求；
 * 2. **经纬度顺序**：高德 `location=lng,lat`，腾讯 `location=lat,lng`，两家相反。
 *    写反了不报错，只会稳定返回一个错误的地点 —— 这正是需要单测锁住的原因。
 */

describe("parseCoords", () => {
  it("解析合法经纬度", () => {
    expect(parseCoords("119.915", "32.485")).toEqual({ lng: 119.915, lat: 32.485 });
    expect(parseCoords("-73.98", "40.75")).toEqual({ lng: -73.98, lat: 40.75 });
  });

  it("缺参或空串返回 null", () => {
    expect(parseCoords(null, "32.485")).toBeNull();
    expect(parseCoords("119.915", null)).toBeNull();
    expect(parseCoords("", "32.485")).toBeNull();
    expect(parseCoords("  ", "32.485")).toBeNull();
  });

  it("非数字返回 null", () => {
    expect(parseCoords("abc", "32.485")).toBeNull();
    expect(parseCoords("119.915", "NaN")).toBeNull();
    expect(parseCoords("Infinity", "32.485")).toBeNull();
  });

  it("越界返回 null", () => {
    expect(parseCoords("181", "32.485")).toBeNull();
    expect(parseCoords("119.915", "91")).toBeNull();
    expect(parseCoords("-181", "0")).toBeNull();
  });

  it("(0,0) 视为「拿不到定位」，返回 null", () => {
    expect(parseCoords("0", "0")).toBeNull();
    expect(parseCoords("0.0", "0.0")).toBeNull();
  });
});

describe("location 参数拼接（经纬度顺序是两家服务商的关键差异）", () => {
  it("高德：经度在前", () => {
    expect(amapLocationParam({ lng: 119.915, lat: 32.485 })).toBe("119.915000,32.485000");
  });

  it("腾讯：纬度在前（与高德相反）", () => {
    expect(tencentLocationParam({ lng: 119.915, lat: 32.485 })).toBe("32.485000,119.915000");
  });
});

describe("parseAmapRegeo", () => {
  it("解析成功响应，adcode 直接是区级", () => {
    const parsed = parseAmapRegeo({
      status: "1",
      regeocode: {
        addressComponent: { adcode: "321202", province: "江苏省", city: "泰州市", district: "海陵区" },
      },
    });
    expect(parsed).toEqual({ adcode: "321202", province: "江苏省", city: "泰州市", district: "海陵区" });
  });

  it("直辖市 city 返回空数组时归一为空串（不能把数组拼进标签）", () => {
    const parsed = parseAmapRegeo({
      status: "1",
      regeocode: { addressComponent: { adcode: "110101", province: "北京市", city: [], district: "东城区" } },
    });
    expect(parsed).toEqual({ adcode: "110101", province: "北京市", city: "", district: "东城区" });
  });

  it("status≠1 或结构不符返回 null", () => {
    expect(parseAmapRegeo({ status: "0", info: "INVALID_USER_KEY" })).toBeNull();
    expect(parseAmapRegeo({ status: "1" })).toBeNull();
    expect(parseAmapRegeo(null)).toBeNull();
  });
});

describe("parseTencentGeocode", () => {
  it("解析成功响应", () => {
    const parsed = parseTencentGeocode({
      status: 0,
      result: {
        address_component: { adcode: "321202", province: "江苏省", city: "泰州市", district: "海陵区" },
      },
    });
    expect(parsed).toEqual({ adcode: "321202", province: "江苏省", city: "泰州市", district: "海陵区" });
  });

  it("status≠0 或结构不符返回 null", () => {
    expect(parseTencentGeocode({ status: 311, message: "签名验证失败" })).toBeNull();
    expect(parseTencentGeocode({ status: 0 })).toBeNull();
    expect(parseTencentGeocode(undefined)).toBeNull();
  });
});

describe("isUsableAdcode", () => {
  it("6 位数字才可用（区级/市级国标码）", () => {
    expect(isUsableAdcode("321202")).toBe(true);
    expect(isUsableAdcode("110000")).toBe(true);
  });

  it("海外/异常返回给不出合法码", () => {
    expect(isUsableAdcode("")).toBe(false);
    expect(isUsableAdcode("32120")).toBe(false);
    expect(isUsableAdcode("3212020")).toBe(false);
    expect(isUsableAdcode("32A202")).toBe(false);
  });
});