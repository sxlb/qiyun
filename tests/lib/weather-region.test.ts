import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * 天气接口的 `region` 字段（供前台欢迎通知复用访客地域，省掉一次请求）。
 *
 * 关键不变式：**region 只在「确实拿到访客自己的公网 IP」且「定位来自腾讯 IP 库」时才出现**。
 * 两个条件缺一不可：
 * - 拿不到访客 IP 时，定位会退化成按**服务器出口 IP** 定位，那是服务器的城市，
 *   展示给访客就是错的（而且看起来像个真实城市，比"未知"更容易误导）；
 * - 高德的 IP 定位常把地级市归到省会，拿它当地域标签比本地离线库更不准。
 * 任一不满足就必须不返回 region，让前台退回 /api/visitor/location（ip2region）。
 * 凡是天气真正落到「站主配置的固定城市」的路径同样不得返回 —— 那是站主的位置。
 */

const profileMock = vi.fn();
/** 访客 IP 可逐用例切换：默认给一个公网 IPv4，另有用例专门给私网地址 */
const env = vi.hoisted(() => ({ ip: "203.0.113.45" }));

vi.mock("@/lib/db", () => ({ prisma: { profile: { findFirst: () => profileMock() } } }));
vi.mock("@/lib/server", () => ({ getClientIp: () => env.ip }));

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
  env.ip = "203.0.113.45";
  stubApis();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("天气接口 · 访客地域字段", () => {
  it("高德自动定位：拿到 city 但没有 region —— 高德的 IP 定位常把地级市归到省会，不能当地域标签", async () => {
    profileMock.mockResolvedValue(baseProfile({ amapKey: "k" }));

    const { status, body } = await getWeather();

    expect(status).toBe(200);
    expect(body.city).toBe("杭州市");
    expect(body.region, "高德定位不作为访客地域，前台应退回本地离线库").toBeUndefined();
    // 定位本身照走（天气查询需要 adcode），只是不产出地域标签
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

  it("拿不到访客公网 IP（私网/代理没转发）时不得返回 region —— 否则显示的是服务器所在城市", async () => {
    // 私网地址会被 pickLocatableIp 拦掉，于是这次定位退化成"按请求来源（服务器出口）IP"，
    // 定位结果其实是服务器的城市：天气照样能查（city 会显示成北京市），但它绝不能当访客地域
    env.ip = "192.168.1.5";
    profileMock.mockResolvedValue(baseProfile({ txWeatherKey: "t", txWeatherSk: "s" }));

    const { status, body } = await getWeather();

    expect(status).toBe(200);
    expect(body.city).toBe("北京市"); // 定位确实发生了
    expect(body.region, "服务器所在城市不能当成访客地域").toBeUndefined();
    // 定位请求里不能带这个私网 IP（带了上游必然失败），确认走的是"不传 ip"的分支
    expect(decodedCalls().some((u) => u.includes("ip=192.168.1.5"))).toBe(false);
  });

  it("同一个坑：高德链路 + 私网 IP 同样不返回 region", async () => {
    env.ip = "10.0.0.7";
    profileMock.mockResolvedValue(baseProfile({ amapKey: "k" }));

    const { body } = await getWeather();

    expect(body.city).toBe("杭州市");
    expect(body.region).toBeUndefined();
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
