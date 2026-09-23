import { NextResponse, NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { getClientIp } from "@/lib/server";
import { pickLocatableIp, resolveAmapCityQuery, buildTencentParams, parseTencentRealtime } from "@/lib/weather";

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
  return /^[0-9a-fA-F:.]+$/.test(cleaned) ? cleaned : "";
}

/**
 * 腾讯位置服务 WebServiceAPI 的签名与响应解析见 lib/tencent.ts
 * （其中「请求路径必须参与签名」是最容易踩的坑，已单独抽出并加回归测试）。
 */

/**
 * 高德 Web 服务 API 数字签名（官方规范）：
 * sig = MD5(参数按名升序排序的 "k=v&k=v" 拼接串 + 私钥)
 * - 参与签名的参数包含 key，不含 sig 本身
 * - 值不做 URL 编码（请求时再编码，与官方「＋号正常计算 sig」一致）；私钥直接拼接（无 & 前缀）
 * - MD5 输出小写 hex
 */
function amapSign(params: Record<string, string>, secret: string): string {
  const query = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return createHash("md5").update(`${query}${secret}`, "utf8").digest("hex");
}

/** 组装高德请求参数（含可选签名） */
function buildAmapParams(base: Record<string, string>, secret: string): URLSearchParams {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(base)) sp.set(k, v);
  if (secret) sp.set("sig", amapSign(base, secret));
  return sp;
}

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

/** 高德实况天气查询（cityCode 为 adcode 或城市名；amap 源与混合模式共用） */
async function amapWeatherQuery(
  amapKey: string,
  cityCode: string,
  secret: string,
  fallbackCity: string
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
 * 腾讯位置服务 IP 定位：返回 6 位 adcode 与市级展示名。
 * 腾讯 Key 版与混合模式（腾讯定位 + 高德天气）共用。
 */
async function tencentIpLocate(
  txKey: string,
  txSk: string,
  ip: string
): Promise<{ adcode: string; city: string }> {
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
  // 展示用名称取市级（如「盐城市」）；只有区县/省份时逐级回退
  const city = ad.city || ad.district || ad.province || "未知地区";
  return { adcode, city };
}

async function fetchTencentKeyWeather(txKey: string, txSk: string, ip: string): Promise<WeatherResult> {
  const { adcode, city } = await tencentIpLocate(txKey, txSk, ip);

  // 腾讯天气实况（同样携带签名；adcode 用定位结果）
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
  return { city, ...parsed };
}

// ===== 数据源 4：混合模式（腾讯 IP 定位 + 高德实况天气） =====
// 取长补短：腾讯 IP 库精度高于高德（境内可到区县），高德天气接口实况稳定；
// adcode 为国标行政区划码，高德天气接口直接识别。
// 配置了固定城市时跳过定位直接查高德，省一次定位调用。
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
  const { adcode, city } = await tencentIpLocate(txKey, txSk, ip);
  return amapWeatherQuery(amapKey, adcode, amapSecret, city);
}

export async function GET(request: NextRequest) {
  // 访客真实 IP：天气自动定位使用（取 x-forwarded-for 首个 IP，可被代理设置）
  const visitorIp = sanitizeIp(getClientIp(request));
  const profile = await prisma.profile.findFirst().catch(() => null);
  const provider = profile?.weatherProvider || "";
  const amapKey = profile?.amapKey || "";
  const amapSecretKey = profile?.amapSecretKey || "";
  const weatherCity = profile?.weatherCity || "";
  const txKey = profile?.txWeatherKey || "";
  const txSk = profile?.txWeatherSk || "";
  // 缓存键：配置了固定城市则全局共享；未配置（按访客 IP 自动定位）则按 IP 区分，避免跨访客串缓存。
  // 密钥等不含明文入键，整体取 SHA-256 摘要，避免密钥泄漏进缓存键/日志
  const cacheKey = createHash("sha256")
    .update(
      `${provider}|${amapKey}|${amapSecretKey}|${weatherCity}|${txKey}|${txSk}|${weatherCity ? "" : visitorIp}`
    )
    .digest("hex");

  // 命中有效缓存：直接返回（响应 <100ms，且不再打外部接口）
  const cached = getWeatherCache(cacheKey);
  if (cached) return NextResponse.json(cached);

  // 未配置固定城市时按访客 IP 自动定位：对出站请求做宽松限流，
  // 防止伪造 x-forwarded-for 频繁触发外部天气接口
  if (!weatherCity && isIpRateLimited(visitorIp)) {
    return NextResponse.json({ error: "请求过于频繁，请稍后再试" }, { status: 429 });
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

  // 自动定位（未指定固定城市）时优先用腾讯位置服务：
  // 它的 IP 库在境内能精确到区县，而高德的 IP 库常把地级市归到省会
  // （实测 223.107.142.72 在盐城：高德给「南京市」，腾讯给「盐城市/盐都区」）。
  // 配置了固定城市时保持用户选择的数据源优先。
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
