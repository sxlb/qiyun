import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { tencentSign, buildTencentParams, parseTencentRealtime } from "@/lib/weather";

const SK = "test-sk-0123456789";

/** 独立算一遍文档规定的字符串，锁死格式 */
function expected(path: string, query: string) {
  return createHash("md5").update(`/${path}?${query}${SK}`).digest("hex").toUpperCase();
}

describe("腾讯位置服务签名（漏掉请求路径会稳定 111 的回归）", () => {
  it("签名串是 /路径?按 key 升序的参数串 + SK", () => {
    const params = { key: "K1", ip: "223.107.142.72" };
    expect(tencentSign("ws/location/v1/ip", params, SK)).toBe(
      expected("ws/location/v1/ip", "ip=223.107.142.72&key=K1")
    );
  });

  it("请求路径参与签名：换路径结果必须不同（旧实现只拼参数串，故恒为 111）", () => {
    const params = { key: "K1" };
    const locationSig = tencentSign("ws/location/v1/ip", params, SK);
    const weatherSig = tencentSign("ws/weather/v1/", params, SK);
    expect(locationSig).not.toBe(weatherSig);
    // 与「不带路径」的写法也必须不同，防止有人改回旧实现
    const wrong = createHash("md5").update(`key=K1${SK}`).digest("hex").toUpperCase();
    expect(locationSig).not.toBe(wrong);
  });

  it("路径带不带前导斜杠等价；参数值做 URL 编码", () => {
    const params = { city: "盐城 市" };
    expect(tencentSign("ws/geocoder/v1/", params, SK)).toBe(tencentSign("/ws/geocoder/v1/", params, SK));
    expect(tencentSign("ws/geocoder/v1/", params, SK)).toBe(
      expected("ws/geocoder/v1/", "city=%E7%9B%90%E5%9F%8E%20%E5%B8%82")
    );
  });

  it("buildTencentParams 在 sk 非空时附带 sig，为空时不带", () => {
    const withSig = buildTencentParams("ws/location/v1/ip", { key: "K1" }, SK);
    expect(withSig.get("key")).toBe("K1");
    expect(withSig.get("sig")).toBe(tencentSign("ws/location/v1/ip", { key: "K1" }, SK));

    const noSig = buildTencentParams("ws/location/v1/ip", { key: "K1" }, "");
    expect(noSig.get("sig")).toBeNull();
  });
});

describe("腾讯实况天气解析（结构是 result.realtime[].infos，不是 result.now）", () => {
  it("解析线上真实返回", () => {
    const payload = {
      status: 0,
      message: "Success",
      result: {
        realtime: [
          {
            province: "江苏省",
            city: "盐城市",
            district: "盐都区",
            adcode: 320903,
            update_time: "2026-09-13 18:15",
            infos: {
              weather: "多云",
              temperature: 26,
              wind_direction: "北风",
              wind_power: "1-2级",
            },
          },
        ],
      },
    };
    expect(parseTencentRealtime(payload)).toEqual({
      weather: "多云",
      temperature: "26℃",
      winddirection: "北风",
      windpower: "1-2级",
    });
  });

  it("风向/风力缺少「风」「级」后缀时自动补齐", () => {
    const payload = {
      status: 0,
      result: { realtime: [{ infos: { weather: "晴", temperature: 30, wind_direction: "东南", wind_power: "3-4" } }] },
    };
    expect(parseTencentRealtime(payload)).toEqual({
      weather: "晴",
      temperature: "30℃",
      winddirection: "东南风",
      windpower: "3-4级",
    });
  });

  it("status 非 0 或缺少 realtime 时返回 null（交给上层切换数据源）", () => {
    expect(parseTencentRealtime({ status: 347, message: "查询无结果", result: null })).toBeNull();
    expect(parseTencentRealtime({ status: 0, result: {} })).toBeNull();
    expect(parseTencentRealtime(null)).toBeNull();
    expect(parseTencentRealtime({ status: 0, result: { realtime: [] } })).toBeNull();
  });
});
