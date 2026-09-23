import { describe, it, expect } from "vitest";
import { profileSchema, weatherSettingSchema } from "@/lib/validation";
import { isProvinceLevelAdcode, pickLocatableIp, resolveAmapCityQuery } from "@/lib/weather";

describe("高德城市查询参数（天气只显示省份的回归）", () => {
  it("识别省级 adcode（后四位为 0）", () => {
    expect(isProvinceLevelAdcode("330000")).toBe(true);
    expect(isProvinceLevelAdcode("110000")).toBe(true);
    expect(isProvinceLevelAdcode("440300")).toBe(false);
    expect(isProvinceLevelAdcode("110101")).toBe(false);
    expect(isProvinceLevelAdcode("")).toBe(false);
  });

  it("市级 adcode 优先（最精确）", () => {
    expect(resolveAmapCityQuery({ adcode: "440300", city: "深圳市", province: "广东省" })).toBe("440300");
  });

  it("省级 adcode + 城市名时用城市名，避免只显示省份", () => {
    // 线上实例：112.17.0.1 → { province: 浙江省, city: 杭州市, adcode: 330000 }
    // 直接传 adcode 会返回 city="浙江省"（页面只显示省份）
    expect(resolveAmapCityQuery({ adcode: "330000", city: "杭州市", province: "浙江省" })).toBe("杭州市");
    // 直辖市 adcode 也是省级（110000），用城市名同样正确
    expect(resolveAmapCityQuery({ adcode: "110000", city: "北京市", province: "北京市" })).toBe("北京市");
  });

  it("只有省份时退回省份名，全空时返回空串（由调用方报错）", () => {
    expect(resolveAmapCityQuery({ adcode: "330000", province: "浙江省" })).toBe("浙江省");
    expect(resolveAmapCityQuery({ adcode: "330000" })).toBe("330000");
    expect(resolveAmapCityQuery({ province: [], city: [], adcode: [] })).toBe("");
  });

  it("兼容高德返回数组形式（province: ['浙江省']）", () => {
    expect(resolveAmapCityQuery({ adcode: ["330000"], city: ["杭州市"] })).toBe("杭州市");
  });
});

describe("定位 IP 筛选（仅公网 IPv4 传给定位接口）", () => {
  it("公网 IPv4 原样通过", () => {
    expect(pickLocatableIp("119.123.64.1")).toBe("119.123.64.1");
    expect(pickLocatableIp("223.107.142.72")).toBe("223.107.142.72");
    expect(pickLocatableIp("8.8.8.8")).toBe("8.8.8.8");
  });

  it("IPv6 / 含冒号值返回空（含冒号参与腾讯签名会失败，且两家 IPv6 定位支持极弱）", () => {
    expect(pickLocatableIp("::1")).toBe("");
    expect(pickLocatableIp("2408:8207:1234:5678::1")).toBe("");
  });

  it("私网 / 回环 / 链路本地 / CGNAT / 保留段返回空", () => {
    expect(pickLocatableIp("192.168.1.10")).toBe("");
    expect(pickLocatableIp("10.0.0.5")).toBe("");
    expect(pickLocatableIp("172.16.0.1")).toBe("");
    expect(pickLocatableIp("172.31.255.255")).toBe("");
    expect(pickLocatableIp("127.0.0.1")).toBe("");
    expect(pickLocatableIp("169.254.1.1")).toBe("");
    expect(pickLocatableIp("100.64.0.1")).toBe("");
    expect(pickLocatableIp("0.0.0.0")).toBe("");
  });

  it("私网段边界外的公网地址正常通过", () => {
    expect(pickLocatableIp("172.32.0.1")).toBe("172.32.0.1");
    expect(pickLocatableIp("172.15.0.1")).toBe("172.15.0.1");
    expect(pickLocatableIp("100.63.0.1")).toBe("100.63.0.1");
    expect(pickLocatableIp("100.128.0.1")).toBe("100.128.0.1");
  });

  it("非法值返回空", () => {
    expect(pickLocatableIp("")).toBe("");
    expect(pickLocatableIp("not-an-ip")).toBe("");
    expect(pickLocatableIp("999.1.1.1")).toBe("");
    expect(pickLocatableIp("1.2.3")).toBe("");
  });
});

describe("天气数据源枚举（amap/tencent/tencent-key，wttr/uapis 仅存量兼容）", () => {
  it("profileSchema 接受 amap/tencent/tencent-key/tencent-loc-amap，且兼容历史 wttr/uapis 值", () => {
    for (const provider of ["wttr", "amap", "tencent", "tencent-key", "tencent-loc-amap", "uapis"]) {
      const result = profileSchema.safeParse({ weatherProvider: provider });
      expect(result.success).toBe(true);
    }
  });

  it("profileSchema 缺省时默认 tencent", () => {
    const result = profileSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.weatherProvider).toBe("tencent");
    }
  });

  it("profileSchema 拒绝非法数据源", () => {
    const result = profileSchema.safeParse({ weatherProvider: "foo" });
    expect(result.success).toBe(false);
  });

  it("weatherSettingSchema 兼容历史 wttr 值（存量数据）", () => {
    expect(weatherSettingSchema.safeParse({ weatherProvider: "wttr" }).success).toBe(true);
  });

  it("weatherSettingSchema 高德必须配置 Key", () => {
    expect(weatherSettingSchema.safeParse({ weatherProvider: "amap", amapKey: "" }).success).toBe(false);
    expect(
      weatherSettingSchema.safeParse({ weatherProvider: "amap", amapKey: "8a4f..." }).success
    ).toBe(true);
  });

  it("weatherSettingSchema 腾讯必须配置城市", () => {
    expect(
      weatherSettingSchema.safeParse({ weatherProvider: "tencent", weatherCity: "" }).success
    ).toBe(false);
    expect(
      weatherSettingSchema.safeParse({ weatherProvider: "tencent", weatherCity: "深圳" }).success
    ).toBe(true);
  });

  it("weatherSettingSchema 腾讯 Key 版必须配置腾讯位置服务 Key", () => {
    expect(
      weatherSettingSchema.safeParse({ weatherProvider: "tencent-key", txWeatherKey: "" }).success
    ).toBe(false);
    expect(
      weatherSettingSchema.safeParse({ weatherProvider: "tencent-key", txWeatherKey: "JXVBZ-XXX" }).success
    ).toBe(true);
  });

  it("profileSchema 腾讯 Key 版可配置 txWeatherKey", () => {
    const result = profileSchema.safeParse({ weatherProvider: "tencent-key", txWeatherKey: "JXVBZ-XXX" });
    expect(result.success).toBe(true);
  });

  it("weatherSettingSchema 混合模式必须同时配置腾讯 Key 与高德 Key", () => {
    expect(weatherSettingSchema.safeParse({ weatherProvider: "tencent-loc-amap" }).success).toBe(false);
    expect(
      weatherSettingSchema.safeParse({ weatherProvider: "tencent-loc-amap", txWeatherKey: "JXVBZ-XXX" }).success
    ).toBe(false);
    expect(
      weatherSettingSchema.safeParse({ weatherProvider: "tencent-loc-amap", amapKey: "8a4f..." }).success
    ).toBe(false);
    expect(
      weatherSettingSchema.safeParse({
        weatherProvider: "tencent-loc-amap",
        txWeatherKey: "JXVBZ-XXX",
        amapKey: "8a4f...",
      }).success
    ).toBe(true);
  });

  it("weatherSettingSchema 拒绝非法数据源", () => {
    expect(weatherSettingSchema.safeParse({ weatherProvider: "foo" }).success).toBe(false);
  });
});
