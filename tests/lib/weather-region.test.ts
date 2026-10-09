import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * 天气接口新增的 `region` 字段（供前台欢迎通知复用访客地域，省掉一次请求）。
 *
 * 关键不变式：**region 与 city 同源**。只有这次天气确实按访客 IP 定位过才会带上 region，
 * 而那时候 city 也是访客的城市。凡是天气真正落到「站主配置的固定城市」的路径都不得返回
 * region —— 否则会把站主的位置当成访客的位置展示出去，这是本文件最要紧的一条。
 */

const profileMock = vi.fn();

vi.mock("@/lib/db", () => ({ prisma: { profile: { findFirst: () => profileMock() } } }));
vi.mock("@/lib/server", () => ({ getClientIp: () => "203.0.113.45" }));

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

/** 本次用例期间的实际出站请求，用来断言「有没有真的去定位」 */
let calls: string[] = [];

function stubApis() {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("restapi.amap.com/v3/ip")) {
        // 高德 IP 定位的典型返回：省级 adcode + 市级名称
        return jsonResponse({ status: "1", province: "浙江省", city: "杭州市", adcode: "330000" });
      }
      if (url.includes("restapi.amap.com/v3/weather/weatherInfo")) {
        return jsonResponse({
          status: "1",
          lives: [{ province: "浙江省", city: "杭州市", weather: "晴", temperature: "25", winddirection: "东", windpower: "3" }],
        });
      }
      if (url.includes("apis.map.qq.com/ws/location/v1/ip")) {
        // 直辖市：province 与 city 同名
        return jsonResponse({ status: 0, result: { ad_info: { adcode: 110000, province: "北京市", city: "北京市" } } });
      }
      if (url.includes("apis.map.qq.com/ws/weather/v1/")) {
        return jsonResponse({
          status: 0,
          result: { realtime: [{ infos: { weather: "晴", temperature: 25, wind_direction: "东", wind_power: "3" } }] },
        });
      }
      return jsonResponse({});
    })
  );
}

function baseProfile(over: Record<string, unknown> = {}) {
  return {
    weatherProvider: "",
    amapKey: "",
    amapSecretKey: "",
    weatherCity: "",
    txWeatherKey: "",
    txWeatherSk: "",
    ...over,
  };
}

async function getWeather() {
  const { GET } = await import("@/app/api/weather/route");
  const res = await GET(
    new NextRequest("http://localhost:3000/api/weather", { headers: { "x-forwarded-for": "203.0.113.45" } })
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** 出站 URL 是编码过的，比较中文前先解码 */
const decodedCalls = () => calls.map((u) => decodeURIComponent(u));

beforeEach(() => {
  vi.clearAllMocks();
  stubApis();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("天气接口 · 访客地域字段", () => {
  it("未配置固定城市：按访客 IP 定位，顺带返回地域标签", async () => {
    profileMock.mockResolvedValue(baseProfile({ amapKey: "k" }));

    const { status, body } = await getWeather();

    expect(status).toBe(200);
    expect(body.city).toBe("杭州市");
    expect(body.region).toBe("浙江省 杭州市");
    // 确实走了 IP 定位，而不是凭空拼出来的
    expect(calls.some((u) => u.includes("restapi.amap.com/v3/ip"))).toBe(true);
  });

  it("配置固定城市：不返回 region，也不发起 IP 定位（站主的位置不能给访客）", async () => {
    profileMock.mockResolvedValue(baseProfile({ amapKey: "k", weatherCity: "成都市" }));

    const { status, body } = await getWeather();

    expect(status).toBe(200);
    expect(body.region).toBeUndefined();
    expect(calls.some((u) => u.includes("restapi.amap.com/v3/ip"))).toBe(false);
    // 天气确实是用配置的城市查的
    expect(decodedCalls().some((u) => u.includes("city=成都市"))).toBe(true);
  });

  it("腾讯 Key 版（本身就是 IP 定位）：返回 region，直辖市省市同名去重", async () => {
    profileMock.mockResolvedValue(baseProfile({ txWeatherKey: "t", txWeatherSk: "s" }));

    const { body } = await getWeather();

    expect(body.city).toBe("北京市");
    // province=北京市 / city=北京市 → 只留一个，不是"北京市 北京市"
    expect(body.region).toBe("北京市");
  });

  it("混合模式配置了固定城市：跳过定位，不返回 region", async () => {
    profileMock.mockResolvedValue(
      baseProfile({ amapKey: "k", txWeatherKey: "t", txWeatherSk: "s", weatherCity: "成都市", weatherProvider: "tencent-loc-amap" })
    );

    const { body } = await getWeather();

    expect(body.region).toBeUndefined();
    expect(calls.some((u) => u.includes("/ws/location/v1/ip"))).toBe(false);
    expect(calls.some((u) => u.includes("/v3/ip"))).toBe(false);
  });
});
