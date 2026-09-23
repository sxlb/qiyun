import { createHash } from "node:crypto";

/**
 * 天气相关工具集（纯逻辑 + 腾讯签名，与网络 IO 分离，便于单测）。
 *
 * 背景：高德的 IP 定位（/v3/ip）经常返回「省级 adcode + 市级名称」的组合，
 * 例如 112.17.0.1 → { province: "浙江省", city: "杭州市", adcode: "330000" }。
 * 若直接拿这个 adcode 去查天气，高德会把查询区域当作"浙江省"处理，
 * 返回的 city 字段就是"浙江省" —— 页面上便只显示出省份。
 */

// ===== 以下导出来自 tencent.ts（已合并） =====

/**
 * 腾讯位置服务 WebServiceAPI 的签名与响应解析（纯函数）。
 *
 * ⚠️ 签名规范与高德不同：腾讯要求**请求路径也参与签名**
 *    sig = MD5("/ws/location/v1/ip?" + 参数串按 key 升序 + SK)   （大写）
 */
function signQuery(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((k) => `${k}=${encodeURIComponent(params[k])}`)
    .join("&");
}

/** 计算腾讯 WebServiceAPI 的 sig（path 必须与真实请求路径一致） */
export function tencentSign(path: string, params: Record<string, string>, sk: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return createHash("md5").update(`${clean}?${signQuery(params)}${sk}`).digest("hex").toUpperCase();
}

/** 组装腾讯请求参数（sk 非空时附带 sig） */
export function buildTencentParams(
  path: string,
  base: Record<string, string>,
  sk: string
): URLSearchParams {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(base)) sp.set(k, v);
  if (sk) sp.set("sig", tencentSign(path, base, sk));
  return sp;
}

export interface TencentRealtimeWeather {
  weather: string;
  temperature: string;
  winddirection: string;
  windpower: string;
}

/** 解析腾讯实况天气；结构不符（status≠0 或无 realtime）返回 null */
export function parseTencentRealtime(payload: unknown): TencentRealtimeWeather | null {
  const root = payload as { status?: number; result?: { realtime?: unknown } } | null;
  if (!root || root.status !== 0) return null;
  const list = root.result?.realtime;
  if (!Array.isArray(list) || list.length === 0) return null;
  const infos = (list[0] as { infos?: Record<string, unknown> } | undefined)?.infos;
  if (!infos) return null;

  const windDirRaw = String(infos.wind_direction ?? "未知");
  const windDir = windDirRaw.endsWith("风") ? windDirRaw : `${windDirRaw}风`;
  const windPowerRaw = String(infos.wind_power ?? "未知");
  const windPower = windPowerRaw.endsWith("级") ? windPowerRaw : `${windPowerRaw}级`;
  const temp = infos.temperature;
  return {
    weather: String(infos.weather ?? "未知"),
    temperature: `${temp ?? "--"}℃`,
    winddirection: windDir,
    windpower: windPower,
  };
}

// ===== 天气纯逻辑 =====

/** 省级 adcode 形如 330000（后四位为 0）；市级为 330100 这类 */
export function isProvinceLevelAdcode(adcode: string): boolean {
  return /^\d{2}0000$/.test(adcode.trim());
}

/** 取首个非空字符串：高德的部分字段可能返回数组（如 province: ["浙江省"]）或空数组 */
export function firstString(value: unknown): string {
  if (Array.isArray(value)) {
    for (const item of value) {
      const s = firstString(item);
      if (s) return s;
    }
    return "";
  }
  return typeof value === "string" ? value.trim() : "";
}

/** 仅匹配 IPv4（定位 IP 筛选用；IPv6 交给不传 ip 参数的按来源定位兜底） */
const LOCATABLE_IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * 判断访客 IP 是否值得传给定位接口（高德 /v3/ip、腾讯 ws/location/v1/ip）。
 *
 * 背景（本地实测）：
 * - 含冒号的 IPv6 参与腾讯签名计算会稳定返回「签名验证失败」（冒号经 URL 编码后
 *   与服务端校验串不一致），且两家对 IPv6 的定位支持都极弱；
 * - 私网 / 回环 / 链路本地 / CGNAT 地址定位必失败。
 *
 * 返回原 IP 表示可传；其余（IPv6、私网、非法值）返回空串——调用方不传 ip 参数，
 * 由数据源按请求来源 IP（服务器出口）定位兜底，至少保证有数据可展示。
 */
export function pickLocatableIp(ip: string): string {
  if (!ip || !LOCATABLE_IPV4_RE.test(ip)) return "";
  const seg = ip.split(".").map(Number);
  if (seg.some((n) => n > 255)) return "";
  const [a, b] = seg;
  if (
    a === 0 || // 0.0.0.0/8 保留
    a === 10 || // 10.0.0.0/8 私网
    a === 127 || // 127.0.0.0/8 回环
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 CGNAT
    (a === 169 && b === 254) || // 169.254.0.0/16 链路本地
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 私网
    (a === 192 && b === 168) // 192.168.0.0/16 私网
  ) {
    return "";
  }
  return ip;
}

/**
 * 推导高德天气的查询参数（city）：
 * 1. 市级 adcode 最精确（如 440300 → 深圳市）；
 * 2. adcode 是省级但给了城市名时必须用城市名（否则只返回省份）；
 * 3. 再退回省份名，最后才用 adcode；全空则由调用方报「需要指定城市」。
 */
export function resolveAmapCityQuery(input: {
  adcode?: unknown;
  city?: unknown;
  province?: unknown;
}): string {
  const adcode = firstString(input.adcode);
  const city = firstString(input.city);
  const province = firstString(input.province);
  if (adcode && !isProvinceLevelAdcode(adcode)) return adcode;
  return city || province || adcode;
}
