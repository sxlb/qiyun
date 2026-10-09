import { NextResponse, NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { getClientIp } from "@/lib/server";
import { pickLocatableIp, resolveAmapCityQuery, buildTencentParams, parseTencentRealtime } from "@/lib/weather";
import { composeRegionLabel } from "@/lib/region-label";
import { buildAmapParams } from "@/lib/amap";
import {
  parseCoords,
  amapLocationParam,
  tencentLocationParam,
  parseAmapRegeo,
  parseTencentGeocode,
  isUsableAdcode,
  type Coords,
  type ReverseGeocodeResult,
} from "@/lib/regeo";

export const dynamic = "force-dynamic";

interface AmapWeather {
  status?: string;
  info?: string;
  lives?: Array<{
    province?: string;
    city?: string;
    weather?: string;
    temperature?: string;
    winddirection?: string;
    windpower?: string;
  }>;
}

interface TencentWeather {
  data?: {
    observe?: {
      degree?: string;
      weather?: string;
      wind_direction?: string;
      wind_direction_name?: string;
      wind_power?: string;
    };
  };
}

interface WeatherResult {
  city: string;
  weather: string;
  temperature: string;
  winddirection: string;
  windpower: string;
  /**
   * 访客地域标签（如"江苏省 泰州市 海陵区"）。
   *
   * 两条链路可以产出它，都要求「这次定位的位置确实是访客的」：
   *
   * **A. 浏览器精确定位**（访客带了 `lng`/`lat`）：逆地理编码来自高德/腾讯的**地址库**，
   *    精度到区县，且坐标由访客设备给出、不受运营商 IP 登记地影响 —— 这是唯一能绕开
   *    「IP 登记在邻市」的手段。拿到合法 adcode 就产出标签。
   *
   * **B. 腾讯位置服务的 IP 定位**：境内精度最高的 IP 库（可到区县），但需同时满足：
   *    1. 用的是访客自己的公网 IP（`locIp` 非空）—— 拿不到时会退化成「按服务器出口 IP
   *       定位」，那是服务器的城市，展示给访客就是错的；
   *    2. 定位至少到市级 —— 腾讯对部分机房/异常 IP 只返回省份（city/district 皆空），
   *       那时的标签就是个省份名，当地域标签没有意义。
   *    高德的 IP 定位刻意不用作访客地域：它常把地级市归到省会，拿它当地域标签反而更不准。
   *
   * 两条都不成立就不返回 `region`，前台欢迎通知会退回本地离线库
   * （/api/visitor/location，ip2region，天花板市级）。这正是「宁可粗一点，也不能显示错的」的取舍。
   *
   * 反过来，凡是天气查询真正落到「站主配置的固定城市」的路径（配置了 weatherCity），
   * 都不会返回它：那是站主的位置，展示给访客就是错的。
   */
  region?: string;
}

// 按 IP 的轻量出站频率限制：仅针对"按访客 IP 自动定位"（未配置固定城市）的请求生效。
// x-forwarded-for 可被请求方伪造，防止频繁触发外部天气出站请求。
const WEATHER_IP_WINDOW_MS = 60 * 1000;
const WEATHER_IP_LIMIT = 30;
const ipRequests = new Map<string, { count: number; firstAt: number }>();
// ipRequests 硬上限：超过后先清理过期项，仍满则淘汰最旧（首个插入）条目，确保有界
const IP_REQUESTS_HARD_CAP = 10_000;
function isIpRateLimited(ip: string): boolean {
  const now = Date.now();
  const rec = ipRequests.get(ip);
  if (!rec || now - rec.firstAt > WEATHER_IP_WINDOW_MS) {
    if (ipRequests.size >= IP_REQUESTS_HARD_CAP) {
      for (const [k, v] of ipRequests) {
        if (now - v.firstAt > WEATHER_IP_WINDOW_MS) ipRequests.delete(k);
      }
      // 清理后仍满：淘汰最旧条目，保证严格有界（键按插入序，首个即最旧）
      while (ipRequests.size >= IP_REQUESTS_HARD_CAP) {
        const oldest = ipRequests.keys().next().value;
        if (oldest === undefined) break;
        ipRequests.delete(oldest);
      }
    }
    ipRequests.set(ip, { count: 1, firstAt: now });
    return false;
  }
  rec.count += 1;
  return rec.count > WEATHER_IP_LIMIT;
}

/** 清洗访客 IP：仅保留 IPv4/IPv6 合法字符，防止拼接进定位接口 URL 造成注入 */
function sanitizeIp(ip: string): string {
  if (!ip) return "";
  const cleaned = ip.trim();
  // 冒号用 \x3A 转义：避免被 Tailwind 内容扫描误当作任意属性类（[prop:value]）生成非法 CSS
  return /^[0-9a-fA-F\x3A.]+$/.test(cleaned) ? cleaned : "";
}

/**
 * 腾讯位置服务 WebServiceAPI 的签名与响应解析见 lib/tencent.ts
 * （其中「请求路径必须参与签名」是最容易踩的坑，已单独抽出并加回归测试）。
 * 高德的数字签名见 lib/amap.ts（同样抽出：健康检查漏签名曾导致误报）。
 */

// ===== 天气结果缓存（5 分钟 TTL）=====
// 目的：高德 / 腾讯等外部数据源响应慢且不稳定，
// 为每个访客都实时请求会拖慢接口并刷屏日志。缓存命中后响应 <100ms。
interface WeatherCacheEntry {
  data: WeatherResult;
  expireAt: number;
}
const weatherCache = new Map<string, WeatherCacheEntry>();
const WEATHER_CACHE_TTL = 5 * 60 * 1000; // 5 分钟
const WEATHER_CACHE_HARD_CAP = 200; // 缓存条目硬上限，超出淘汰最旧防御内存 DoS

/** 读取有效缓存 */
function getWeatherCache(key: string): WeatherResult | null {
  const entry = weatherCache.get(key);
  if (!entry) return null;
  if (entry.expireAt > Date.now()) return entry.data;
  weatherCache.delete(key);
  return null;
}

/** 数据源全部失败时的过期兜底（弱网/上游挂掉时仍能返回最近一次成功数据） */
function getStaleWeatherCache(key: string): WeatherResult | null {
  const entry = weatherCache.get(key);
  return entry ? entry.data : null;
}

/** 写入缓存 */
function setWeatherCache(key: string, data: WeatherResult): void {
  weatherCache.set(key, { data, expireAt: Date.now() + WEATHER_CACHE_TTL });
  // 防止无限增长：未配置固定城市时缓存按访客 IP 区分，攻击者可伪造大量 XFF IP
  // 制造海量唯一键。先清理过期项，仍超上限则淘汰最旧条目，保证内存严格有界。
  if (weatherCache.size > WEATHER_CACHE_HARD_CAP) {
    const now = Date.now();
    for (const [k, v] of weatherCache) {
      if (v.expireAt <= now) weatherCache.delete(k);
    }
    while (weatherCache.size > WEATHER_CACHE_HARD_CAP) {
      const oldest = weatherCache.keys().next().value;
      if (oldest === undefined) break;
      weatherCache.delete(oldest);
    }
  }
}

// ===== 数据源 1：高德天气（需 Web 服务 Key，city 必填：adcode 或城市名） =====
// 未指定城市时用访客 IP 自动定位（ip 可为空，此时退回服务器 IP 定位）；
// secret 非空时按高德签名规范生成 sig（key 开启数字签名时必填，未开启可留空直调）
async function fetchAmapWeather(
  amapKey: string,
  city: string,
  ip: string,
  secret: string
): Promise<WeatherResult> {
  let cityCode = city.trim();
  // 高德天气接口必须传 city（adcode），否则返回 20000 INVALID_PARAMS：
  // 未指定城市时尝试 IP 定位自动获取 adcode
  if (!cityCode) {
    try {
      const locParams: Record<string, string> = { key: amapKey };
      // 仅公网 IPv4 才传 ip：IPv6/私网传参必失败（且含冒号会破坏腾讯签名），
      // 不传则按请求来源 IP（服务器出口）定位兜底
      const locIp = pickLocatableIp(ip);
      if (locIp) locParams.ip = locIp;
      const url = new URL("https://restapi.amap.com/v3/ip");
      url.search = buildAmapParams(locParams, secret).toString();
      const ipRes = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      if (ipRes.ok) {
        const ipData = (await ipRes.json()) as {
          status?: string;
          info?: string;
          adcode?: string | string[];
          city?: string | string[];
          province?: string | string[];
        };
        if (ipData.status === "1") {
          // 不能直接取 adcode：高德 IP 定位常给出「省级 adcode + 市级名称」，
          // 用省级 adcode 查天气只会返回省份（页面显示「浙江省」而非「杭州市」）
          const query = resolveAmapCityQuery(ipData);
          if (query) {
            // 只取查询参数，**不带地域标签**：高德的 IP 定位常把地级市归到省会，
            // 拿它当访客地域比本地离线库更不准（详见 WeatherResult.region 的说明）
            cityCode = query;
          } else {
            // 高德对识别不了的来源 IP 会返回 status=1 但字段全空（实测），留痕便于排查
            console.warn(`[weather] 高德 IP 定位无结果（ip=${locIp || "未传，按来源定位"}）`);
          }
        } else {
          console.warn(`[weather] 高德 IP 定位接口报错: ${ipData.info || ipData.status}`);
        }
      } else {
        console.warn(`[weather] 高德 IP 定位 HTTP ${ipRes.status}`);
      }
    } catch (e) {
      console.warn(`[weather] 高德 IP 定位请求异常: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (!cityCode) {
    throw new Error(
      "高德无法定位访客 IP 且未配置固定城市（可在后台「天气设置 → 城市」填写城市名，或改用腾讯 Key 版数据源）"
    );
  }
  return amapWeatherQuery(amapKey, cityCode, secret, "");
}

/** 高德实况天气查询（cityCode 为 adcode 或城市名；amap 源与混合模式共用）
 *  region：按访客 IP 定位时解析出的地域标签，原样带回给前台（见 WeatherResult.region） */
async function amapWeatherQuery(
  amapKey: string,
  cityCode: string,
  secret: string,
  fallbackCity: string,
  region = ""
): Promise<WeatherResult> {
  const wParams: Record<string, string> = {
    key: amapKey,
    city: cityCode,
    extensions: "base",
    output: "JSON",
  };
  const res = await fetch(
    `https://restapi.amap.com/v3/weather/weatherInfo?${buildAmapParams(wParams, secret).toString()}`,
    {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    }
  );
  if (!res.ok) throw new Error("amap http error");
  const data = (await res.json()) as AmapWeather;
  if (data.status !== "1" || !data.lives?.[0]) {
    throw new Error(`amap api error: ${data.info || "未知错误"}（${data.status}）`);
  }
  const live = data.lives[0];
  const winddirection =
    live.winddirection && live.winddirection.endsWith("风")
      ? live.winddirection
      : `${live.winddirection || "未知"}风`;
  const windpowerRaw = String(live.windpower ?? "未知");
  const windpower = windpowerRaw.endsWith("级") ? windpowerRaw : `${windpowerRaw}级`;
  return {
    city: live.city || live.province || fallbackCity || "未知地区",
    weather: live.weather || "未知",
    temperature: `${live.temperature ?? "--"}℃`,
    winddirection,
    windpower,
    // 空字符串不进响应体：前台据此判断"能不能复用天气这次定位"
    ...(region ? { region } : {}),
  };
}

// ===== 数据源 2：腾讯天气（免费无密钥，需城市名，先反查省/市再查实况） =====
async function fetchTencentWeather(city: string): Promise<WeatherResult> {
  // 1. 城市反查：city/like 返回 { "101280601": "广东, 深圳" }
  const likeRes = await fetch(
    `https://wis.qq.com/city/like?source=pc&city=${encodeURIComponent(city)}`,
    { cache: "no-store", signal: AbortSignal.timeout(8000) }
  );
  if (!likeRes.ok) throw new Error("tencent city http error");
  const likeData = (await likeRes.json()) as { data?: Record<string, string> };
  const firstKey = likeData.data ? Object.keys(likeData.data)[0] : null;
  if (!firstKey || !likeData.data) throw new Error(`未找到城市：${city}`);
  const [province, cityName] = String(likeData.data[firstKey])
    .split(",")
    .map((s) => s.trim());

  // 2. 实况天气
  const wRes = await fetch(
    `https://wis.qq.com/weather/common?source=pc&weather_type=observe&province=${encodeURIComponent(
      province
    )}&city=${encodeURIComponent(cityName)}`,
    { cache: "no-store", signal: AbortSignal.timeout(8000) }
  );
  if (!wRes.ok) throw new Error("tencent weather http error");
  const wData = (await wRes.json()) as TencentWeather;
  const observe = wData.data?.observe;
  if (!observe) throw new Error("tencent weather no data");
  // 优先使用中文风向名（wind_direction_name），回退到 wind_direction
  const windDirRaw = observe.wind_direction_name || observe.wind_direction || "未知";
  const winddirection = windDirRaw.endsWith("风") ? windDirRaw : `${windDirRaw}风`;
  const windpowerRaw = String(observe.wind_power ?? "未知");
  const windpower = windpowerRaw.endsWith("级") ? windpowerRaw : `${windpowerRaw}级`;
  return {
    city: cityName || city,
    weather: observe.weather || "未知",
    temperature: `${observe.degree ?? "--"}℃`,
    winddirection,
    windpower,
  };
}

// ===== 数据源 3：腾讯天气 Key 版（腾讯位置服务，需 Key：IP 定位 + 实况天气） =====
interface TencentLbsLocation {
  status?: number;
  message?: string;
  result?: {
    ad_info?: { adcode?: number; province?: string; city?: string; district?: string };
  };
}

interface TencentLbsWeather {
  status?: number;
  message?: string;
}

/**
 * 腾讯位置服务 IP 定位：返回 6 位 adcode、市级展示名与地域标签。
 * 腾讯 Key 版与混合模式（腾讯定位 + 高德天气）共用。
 */
async function tencentIpLocate(
  txKey: string,
  txSk: string,
  ip: string
): Promise<{ adcode: string; city: string; region: string }> {
  const locPath = "ws/location/v1/ip";
  const locParams: Record<string, string> = { key: txKey };
  // 仅公网 IPv4 才传 ip：含冒号的 IPv6 参与签名计算会稳定返回「签名验证失败」（实测），
  // 且腾讯对 IPv6 定位支持极弱；不传则按请求来源 IP（服务器出口）定位兜底
  const locIp = pickLocatableIp(ip);
  if (locIp) locParams.ip = locIp;
  const locUrl = new URL(`https://apis.map.qq.com/${locPath}`);
  locUrl.search = buildTencentParams(locPath, locParams, txSk).toString();
  const locRes = await fetch(locUrl, {
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!locRes.ok) throw new Error("tencent-key location http error");
  const loc = (await locRes.json()) as TencentLbsLocation;
  if (loc.status !== 0 || !loc.result?.ad_info?.adcode) {
    throw new Error(`tencent-key location error: ${loc.message || "no adcode"}`);
  }
  const ad = loc.result.ad_info;
  const adcode = String(ad.adcode);
  // 海外/异常 IP 的定位结果 adcode 非 6 位数字（实测 1.1.1.1 触发「adcode长度必须为6」），
  // 此处前置校验直接走降级，避免浪费一次天气出站调用
  if (!/^\d{6}$/.test(adcode)) {
    throw new Error(`tencent-key location error: adcode 非法（${adcode || "空"}，访客可能为海外/内网 IP）`);
  }
  // 展示用名称取市级（如「盐城市」）；只有区县/省份时逐级回退。
  // 注意这里仍是**市级**：天气数据本身按市级给，卡片上显示到市才不会显得数据与地名不匹配。
  const city = ad.city || ad.district || ad.province || "未知地区";
  // 地域标签是「省 + 市 + 区」，与上面展示名的回退口径不同，所以单独组合。
  // 三个条件全满足才给标签：带着访客自己的 IP（locIp）、且定位至少到市级。
  // 腾讯对部分机房/异常 IP 只给到省份（实测 114.114.114.114 → province=江西省、city 与
  // district 均为空），那时标签本身就是个省份名，既不准也没意义，退回本地离线库更好。
  // 区级字段（district）能拿到就带上——这是 IP 链路里唯一的区级来源。
  const region =
    locIp && (ad.city || ad.district)
      ? composeRegionLabel(ad.province, ad.city, ad.district)
      : "";
  return { adcode, city, region };
}

/**
 * 腾讯位置服务实况天气（按 adcode 查，携带签名）。
 * 腾讯 Key 版（IP 定位）与浏览器精确定位链路共用 —— 区别只在 adcode 从哪来。
 */
async function fetchTencentWeatherByAdcode(
  txKey: string,
  txSk: string,
  adcode: string,
  city: string,
  region: string
): Promise<WeatherResult> {
  const weatherPath = "ws/weather/v1/";
  const wParams: Record<string, string> = { key: txKey, adcode, type: "now" };
  const wUrl = new URL(`https://apis.map.qq.com/${weatherPath}`);
  wUrl.search = buildTencentParams(weatherPath, wParams, txSk).toString();
  const wRes = await fetch(wUrl, {
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!wRes.ok) throw new Error("tencent-key weather http error");
  const wData = (await wRes.json()) as TencentLbsWeather;
  // 实况字段在 result.realtime[].infos（解析见 lib/tencent.ts）
  const parsed = parseTencentRealtime(wData);
  if (!parsed) {
    throw new Error(`tencent-key weather error: ${wData.message || "no data"}`);
  }
  return { city, ...(region ? { region } : {}), ...parsed };
}

async function fetchTencentKeyWeather(txKey: string, txSk: string, ip: string): Promise<WeatherResult> {
  const { adcode, city, region } = await tencentIpLocate(txKey, txSk, ip);
  return fetchTencentWeatherByAdcode(txKey, txSk, adcode, city, region);
}

// ===== 浏览器精确定位链路（坐标 → 逆地理编码 → 天气 + 地域标签） =====
// 这是唯一能绕开「运营商 IP 登记地 ≠ 设备实际位置」的手段：坐标由访客设备给出，
// 逆地理编码查的是地址库而非 IP 库，因此不受 IP 池登记影响。

/**
 * 逆地理编码：坐标 → 行政区划。高德优先（其 adcode 直接是**区级**，可原样喂给高德天气），
 * 腾讯兜底。两家都没给出合法 adcode 时返回 null，调用方落回 IP 定位链路。
 */
async function reverseGeocode(
  coords: Coords,
  amapKey: string,
  amapSecret: string,
  txKey: string,
  txSk: string
): Promise<ReverseGeocodeResult | null> {
  if (amapKey) {
    try {
      const params: Record<string, string> = {
        key: amapKey,
        location: amapLocationParam(coords),
        extensions: "base",
        output: "JSON",
      };
      const url = new URL("https://restapi.amap.com/v3/geocode/regeo");
      url.search = buildAmapParams(params, amapSecret).toString();
      const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const parsed = parseAmapRegeo(await res.json());
        if (parsed && isUsableAdcode(parsed.adcode)) return parsed;
        console.warn("[weather] 高德逆地理编码无合法 adcode，尝试腾讯");
      } else {
        console.warn(`[weather] 高德逆地理编码 HTTP ${res.status}`);
      }
    } catch (e) {
      console.warn(`[weather] 高德逆地理编码异常: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (txKey) {
    try {
      const path = "ws/geocoder/v1/";
      const params: Record<string, string> = { key: txKey, location: tencentLocationParam(coords) };
      const url = new URL(`https://apis.map.qq.com/${path}`);
      url.search = buildTencentParams(path, params, txSk).toString();
      const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const parsed = parseTencentGeocode(await res.json());
        if (parsed && isUsableAdcode(parsed.adcode)) return parsed;
        console.warn("[weather] 腾讯逆地理编码无合法 adcode");
      } else {
        console.warn(`[weather] 腾讯逆地理编码 HTTP ${res.status}`);
      }
    } catch (e) {
      console.warn(`[weather] 腾讯逆地理编码异常: ${e instanceof Error ? e.message : e}`);
    }
  }
  return null;
}

/**
 * 精确定位链路的天气查询：adcode 已由逆地理编码给出，直接用，不再走 IP 定位。
 * 数据源优先级与 IP 链路一致（高德 → 腾讯 Key 版）；不含腾讯免费版 ——
 * 它只吃城市名，精度反而比这里已有的区级 adcode 低。
 */
async function weatherByLocate(
  located: ReverseGeocodeResult,
  amapKey: string,
  amapSecret: string,
  txKey: string,
  txSk: string
): Promise<WeatherResult> {
  const region = composeRegionLabel(located.province, located.city, located.district);
  const city = located.city || located.district || located.province || "未知地区";
  if (amapKey) return amapWeatherQuery(amapKey, located.adcode, amapSecret, city, region);
  if (txKey) return fetchTencentWeatherByAdcode(txKey, txSk, located.adcode, city, region);
  throw new Error("未配置可用于精确定位的数据源（需要高德 Key 或腾讯位置服务 Key）");
}

// ===== 数据源 4：混合模式（腾讯 IP 定位 + 高德实况天气） =====
// 取长补短：腾讯 IP 库精度高于高德（境内可到区县），高德天气接口实况稳定，
// 且 adcode 为国标行政区划码可直接识别；配置固定城市时跳过定位直查高德。
async function fetchTencentLocAmapWeather(
  txKey: string,
  txSk: string,
  amapKey: string,
  amapSecret: string,
  weatherCity: string,
  ip: string
): Promise<WeatherResult> {
  const fixedCity = weatherCity.trim();
  if (fixedCity) return amapWeatherQuery(amapKey, fixedCity, amapSecret, "");
  const { adcode, city, region } = await tencentIpLocate(txKey, txSk, ip);
  return amapWeatherQuery(amapKey, adcode, amapSecret, city, region);
}

export async function GET(request: NextRequest) {
  // 访客真实 IP：天气自动定位使用（取 x-forwarded-for 首个 IP，可被代理设置）
  const visitorIp = sanitizeIp(getClientIp(request));
  // 浏览器精确定位坐标（可选，前端在获得授权后带上）。坐标由访客设备提供，
  // 是唯一能绕开「运营商 IP 登记地 ≠ 设备实际位置」的定位依据。
  const coords = parseCoords(
    request.nextUrl.searchParams.get("lng"),
    request.nextUrl.searchParams.get("lat")
  );
  const profile = await prisma.profile.findFirst().catch(() => null);
  const provider = profile?.weatherProvider || "";
  const amapKey = profile?.amapKey || "";
  const amapSecretKey = profile?.amapSecretKey || "";
  const weatherCity = profile?.weatherCity || "";
  const txKey = profile?.txWeatherKey || "";
  const txSk = profile?.txWeatherSk || "";
  // 缓存键：配置了固定城市则全局共享；否则按**本次定位依据**区分（精确定位用坐标，IP 定位用 IP），
  // 避免跨访客串缓存。坐标取 3 位小数（约 100m 精度）——浮点尾差会制造出大量等价唯一键，
  // 白白撑爆缓存上限。密钥等不含明文入键，整体取 SHA-256 摘要，避免密钥泄漏进缓存键/日志。
  const locateKey = weatherCity
    ? ""
    : coords
      ? `${coords.lng.toFixed(3)},${coords.lat.toFixed(3)}`
      : visitorIp;
  const cacheKey = createHash("sha256")
    .update(`${provider}|${amapKey}|${amapSecretKey}|${weatherCity}|${txKey}|${txSk}|${locateKey}`)
    .digest("hex");

  // 命中有效缓存：直接返回（响应 <100ms，且不再打外部接口）
  const cached = getWeatherCache(cacheKey);
  if (cached) return NextResponse.json(cached);

  // 未配置固定城市时按访客 IP 自动定位：对出站请求做宽松限流，
  // 防止伪造 x-forwarded-for 频繁触发外部天气接口
  if (!weatherCity && isIpRateLimited(visitorIp)) {
    return NextResponse.json({ error: "请求过于频繁，请稍后再试" }, { status: 429 });
  }

  // 精确定位链路优先：访客带了合法坐标且站主未配置固定城市时，
  // 用「坐标 → 逆地理编码 → 区级 adcode」查天气，地域标签也据此产出。
  // 任一环节失败都静默落回下面的 IP 定位链路（缓存键仍是这次的坐标，语义上仍属同一访客）。
  if (!weatherCity && coords) {
    const located = await reverseGeocode(coords, amapKey, amapSecretKey, txKey, txSk);
    if (located) {
      try {
        const result = await weatherByLocate(located, amapKey, amapSecretKey, txKey, txSk);
        setWeatherCache(cacheKey, result);
        return NextResponse.json(result);
      } catch (e) {
        console.warn(`[weather] 精确定位链路取天气失败，回退 IP 定位: ${e instanceof Error ? e.message : e}`);
      }
    } else {
      console.warn("[weather] 逆地理编码无结果，回退 IP 定位");
    }
  }

  // 收集可用数据源（高德 / 腾讯 Key 版 / 腾讯免费版 / 混合模式），配置的 provider 优先尝试；
  // 某个源失败时自动切换下一个可用源（如高德挂掉回退腾讯），保证页面可用
  const sources: { name: string; fn: () => Promise<WeatherResult> }[] = [];
  if (amapKey) {
    sources.push({ name: "amap", fn: () => fetchAmapWeather(amapKey, weatherCity, visitorIp, amapSecretKey) });
  }
  if (txKey) {
    sources.push({ name: "tencent-key", fn: () => fetchTencentKeyWeather(txKey, txSk, visitorIp) });
  }
  // 混合模式：腾讯定位 + 高德天气，需两方 Key 同时配置
  if (txKey && amapKey) {
    sources.push({
      name: "tencent-loc-amap",
      fn: () => fetchTencentLocAmapWeather(txKey, txSk, amapKey, amapSecretKey, weatherCity, visitorIp),
    });
  }
  if (weatherCity) {
    sources.push({ name: "tencent", fn: () => fetchTencentWeather(weatherCity) });
  }
  sources.sort((a, b) => (a.name === provider ? -1 : 0) - (b.name === provider ? -1 : 0));

  // 自动定位（未指定固定城市）时优先用腾讯位置服务：其 IP 库在境内可精确到区县，
  // 高德常把地级市归到省会；配置固定城市时保持用户选择的数据源优先。
  if (!weatherCity && txKey) {
    const i = sources.findIndex((s) => s.name === "tencent-key");
    if (i > 0) sources.unshift(sources.splice(i, 1)[0]);
  }

  if (sources.length === 0) {
    return NextResponse.json(
      { error: "未配置天气数据源，请在后台「天气设置」中配置高德 Key 或腾讯天气" },
      { status: 400 }
    );
  }

  let lastError = "";
  for (const src of sources) {
    try {
      const result = await src.fn();
      setWeatherCache(cacheKey, result);
      return NextResponse.json(result);
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      // 密钥类问题给出可照做的提示：腾讯位置服务的 Key 若开启了签名校验，
      // 必须与成对的 SK 一起填写，任一不符都会返回「签名验证失败」而永远取不到数据
      const hint = lastError.includes("签名验证失败")
        ? "（腾讯位置服务 Key 未通过签名校验：请核对后台填写的 Key 与 SK 是否成对）"
        : "";
      console.warn(`[weather] 数据源 ${src.name} 获取失败: ${lastError}${hint}`);
    }
  }

  // 全部失败：优先返回最近一次成功缓存（弱网/上游挂掉时页面仍可用），否则 500
  const stale = getStaleWeatherCache(cacheKey);
  if (stale) return NextResponse.json(stale);
  console.error(`[GET /api/weather] error: ${lastError}`);
  return NextResponse.json({ error: "天气服务异常" }, { status: 500 });
}
