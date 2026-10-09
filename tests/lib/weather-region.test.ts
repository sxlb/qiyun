import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * 天气接口的 `region` 字段（供前台欢迎通知复用访客地域，省掉一次请求）。
 *
 * 关键不变式：**region 要同时满足三个条件才出现**：
 * 1. 确实拿到访客自己的公网 IP（`locIp` 非空）；
 * 2. 定位来自腾讯位置服务的 IP 库（境内精度最高；高德的 IP 定位常把地级市归到省会）；
 * 3. 定位至少到市级（腾讯对部分机房/异常 IP 只返回省份，标签会退化成一个省份名）。
 *
 * 三个条件缺一不可：
 * - 拿不到访客 IP 时，定位会退化成按**服务器出口 IP** 定位，那是服务器的城市，
 *   展示给访客就是错的（而且看起来像个真实城市，比"未知"更容易误导）；
 * - 高德的 IP 定位拿当地域标签比本地离线库更不准；
 * - 只到省级的标签既不准也没意义（实测 114.114.114.114 → 江西省）。
 *
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

/**
 * 腾讯 IP 定位的 ad_info。默认是直辖市（省市同名）；
 * 另有用例专门覆盖「只给到省份」（city / district 皆空）这种精度不足的返回。
 */
let tencentAdInfo: { adcode: number; province: string; city: string; district?: string } = {
  adcode: 110000,
  province: "北京市",
  city: "北京市",
};

/** 高德逆地理编码返回（浏览器精确定位链路用）；另有用例覆盖"给不出结果" */
let amapRegeo: unknown = {
  status: "1",
  regeocode: {
    addressComponent: { adcode: "321202", province: "江苏省", city: "泰州市", district: "海陵区" },
  },
};

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
      if (url.includes("restapi.amap.com/v3/geocode/regeo")) {
        return jsonResponse(amapRegeo);
      }
      if (url.includes("apis.map.qq.com/ws/location/v1/ip")) {
        return jsonResponse({ status: 0, result: { ad_info: tencentAdInfo } });
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

/** 带浏览器精确定位坐标的请求（模拟前端拿到 geolocation 后的调用） */
async function getWeatherWithCoords(lng: number, lat: number) {
  const { GET } = await import("@/app/api/weather/route");
  const res = await GET(
    new NextRequest(`http://localhost:3000/api/weather?lng=${lng}&lat=${lat}`, {
      headers: { "x-forwarded-for": "203.0.113.45" },
    })
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** 出站 URL 是编码过的，比较中文前先解码 */
const decodedCalls = () => calls.map((u) => decodeURIComponent(u));

beforeEach(() => {
  vi.clearAllMocks();
  env.ip = "203.0.113.45";
  tencentAdInfo = { adcode: 110000, province: "北京市", city: "北京市" };
  amapRegeo = {
    status: "1",
    regeocode: {
      addressComponent: { adcode: "321202", province: "江苏省", city: "泰州市", district: "海陵区" },
    },
  };
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

  it("腾讯只给到省级（city/district 皆空）时不返回 region —— 标签会退化成一个省份名", async () => {
    // 实测：114.114.114.114 → province=江西省，city 与 district 均为空。
    // 此时标签本身就是个省份名，既不准也没意义（还会顺带让上游天气查询"查询无结果"），
    // 应当不产出 region，让前台退回本地离线库。
    // 用这个真实 IP 也顺带避开天气结果缓存：缓存键含访客 IP，换 IP 才真的走一遍定位
    env.ip = "114.114.114.114";
    tencentAdInfo = { adcode: 360000, province: "江西省", city: "" };
    profileMock.mockResolvedValue(baseProfile({ txWeatherKey: "t", txWeatherSk: "s" }));

    const { status, body } = await getWeather();

    expect(status).toBe(200);
    expect(body.city).toBe("江西省"); // 展示名仍逐级回退到省份，保证有名字可显示
    expect(body.region, "只到省级的定位不能当地域标签").toBeUndefined();
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

/**
 * 浏览器精确定位链路（访客带了 `lng`/`lat`）。
 *
 * 这是唯一能绕开「运营商 IP 登记地 ≠ 设备实际位置」的手段，因此它必须：
 * - 用坐标做逆地理编码拿到**区级** adcode，天气按这个 adcode 查，地域标签也到区；
 * - 任一环节失败都静默落回 IP 定位（不能因为定位不准就让页面没天气）；
 * - 站主配了固定城市时彻底不理会坐标（那是站主的位置，不能顶替成访客地域）。
 */
describe("天气接口 · 浏览器精确定位链路", () => {
  it("坐标 + 高德 Key：逆地理编码得到区级 adcode，region 精确到区，且不再走 IP 定位", async () => {
    profileMock.mockResolvedValue(baseProfile({ amapKey: "k" }));

    const { status, body } = await getWeatherWithCoords(119.915, 32.485);

    expect(status).toBe(200);
    // 省 + 市 + 区三级标签（高德 regeo 的 adcode 本身就是区级）
    expect(body.region).toBe("江苏省 泰州市 海陵区");
    // 天气用的是逆地理编码给出的区级 adcode，而不是 IP 定位来的城市
    expect(decodedCalls().some((u) => u.includes("city=321202"))).toBe(true);
    // 精确定位成功后不该再多打一次 IP 定位
    expect(calls.some((u) => u.includes("restapi.amap.com/v3/ip"))).toBe(false);
  });

  it("逆地理编码给不出结果时静默回退 IP 定位（页面不能没天气）", async () => {
    amapRegeo = { status: "0", info: "INVALID_USER_KEY" };
    profileMock.mockResolvedValue(baseProfile({ amapKey: "k", txWeatherKey: "t", txWeatherSk: "s" }));

    const { status, body } = await getWeatherWithCoords(120.123, 31.123);

    expect(status).toBe(200);
    // 回退到腾讯 IP 定位链路，region 来自 IP 库
    expect(body.region).toBe("北京市");
    expect(calls.some((u) => u.includes("/ws/location/v1/ip"))).toBe(true);
  });

  it("没有任何 Key 时坐标链路发不出去，直接按「未配置数据源」返回 400", async () => {
    profileMock.mockResolvedValue(baseProfile());

    const { status, body } = await getWeatherWithCoords(121.234, 30.234);

    expect(status).toBe(400);
    expect(String(body.error)).toContain("未配置天气数据源");
    // 逆地理编码需要 Key，没有 Key 就不该白打一次出站请求
    expect(calls.some((u) => u.includes("/geocode/regeo"))).toBe(false);
  });

  it("配置了固定城市：忽略坐标，不返回 region（站主城市不能顶替访客地域）", async () => {
    // 城市名刻意与上一个用例不同：天气结果缓存的键含固定城市，
    // 同名会直接命中缓存而跳过全部出站，断言就失去意义
    profileMock.mockResolvedValue(baseProfile({ amapKey: "k", weatherCity: "重庆市" }));

    const { status, body } = await getWeatherWithCoords(122.345, 29.345);

    expect(status).toBe(200);
    expect(body.region).toBeUndefined();
    expect(calls.some((u) => u.includes("/geocode/regeo"))).toBe(false);
    expect(decodedCalls().some((u) => u.includes("city=重庆市"))).toBe(true);
  });

  it("(0,0) 这类无效坐标被忽略，退回 IP 定位", async () => {
    // 浏览器拿不到定位时会给出 (0,0)，那是几内亚湾，必须当作"没有坐标"
    env.ip = "198.51.100.7";
    profileMock.mockResolvedValue(baseProfile({ txWeatherKey: "t", txWeatherSk: "s" }));

    const { status, body } = await getWeatherWithCoords(0, 0);

    expect(status).toBe(200);
    expect(body.region).toBe("北京市");
    expect(calls.some((u) => u.includes("/geocode/regeo"))).toBe(false);
  });
});
