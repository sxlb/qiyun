/**
 * 逆地理编码（坐标 → 行政区划）的纯逻辑层：坐标校验、请求参数组装、响应解析。
 *
 * 用途：浏览器精确定位（`navigator.geolocation`）拿到的经纬度，需要换成
 * 「省 / 市 / 区 + 区级 adcode」才能既做地域标签、又查天气。
 *
 * 与网络 IO 分离（同 lib/weather.ts 的约定）：route 负责 fetch，这里只做可单测的部分。
 *
 * 两家服务商的差异（实测）：
 * - 高德 `/v3/geocode/regeo`：`location=lng,lat`（经度在前），adcode 直接是**区级**
 *   （如 321202 海陵区），正好可以直接喂给高德天气接口；直辖市时 `city` 返回空数组。
 * - 腾讯 `/ws/geocoder/v1/`：`location=lat,lng`（纬度在前），路径必须参与签名。
 */

export interface Coords {
  lng: number;
  lat: number;
}

/** 逆地理编码结果：adcode 为区级 6 位国标码（拿不到时为空串） */
export interface ReverseGeocodeResult {
  adcode: string;
  province: string;
  city: string;
  district: string;
}

/** 取首个非空字符串（外部接口字段可能是字符串、数组或数字） */
function firstString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const s = firstString(item);
      if (s) return s;
    }
  }
  return "";
}

/**
 * 解析并校验查询串里的经纬度。
 *
 * 拒绝的场景：缺参、非数字、越界、以及 (0,0) —— 后者是"拿不到定位"的默认值，
 * 落在几内亚湾，拿它做逆地理编码既无意义又白费一次出站请求。
 */
export function parseCoords(lngRaw: string | null, latRaw: string | null): Coords | null {
  if (lngRaw === null || latRaw === null) return null;
  if (!lngRaw.trim() || !latRaw.trim()) return null;
  const lng = Number(lngRaw);
  const lat = Number(latRaw);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;
  if (lng === 0 && lat === 0) return null;
  return { lng, lat };
}

/** 高德 location 参数：经度在前 */
export function amapLocationParam(coords: Coords): string {
  return `${coords.lng.toFixed(6)},${coords.lat.toFixed(6)}`;
}

/** 腾讯 location 参数：纬度在前（与高德相反，是最容易写错的一处） */
export function tencentLocationParam(coords: Coords): string {
  return `${coords.lat.toFixed(6)},${coords.lng.toFixed(6)}`;
}

/** 解析高德 regeo 响应；status≠1 或结构不符返回 null */
export function parseAmapRegeo(payload: unknown): ReverseGeocodeResult | null {
  const root = payload as {
    status?: string;
    regeocode?: { addressComponent?: Record<string, unknown> };
  } | null;
  if (!root || root.status !== "1") return null;
  const ad = root.regeocode?.addressComponent;
  if (!ad) return null;
  return {
    adcode: firstString(ad.adcode),
    province: firstString(ad.province),
    city: firstString(ad.city),
    district: firstString(ad.district),
  };
}

/** 解析腾讯 geocoder 响应；status≠0 或结构不符返回 null */
export function parseTencentGeocode(payload: unknown): ReverseGeocodeResult | null {
  const root = payload as {
    status?: number;
    result?: { address_component?: Record<string, unknown> };
  } | null;
  if (!root || root.status !== 0) return null;
  const ad = root.result?.address_component;
  if (!ad) return null;
  return {
    adcode: firstString(ad.adcode),
    province: firstString(ad.province),
    city: firstString(ad.city),
    district: firstString(ad.district),
  };
}

/** 区级/市级 adcode 均为 6 位数字；海外坐标或异常返回给不出合法 adcode */
export function isUsableAdcode(adcode: string): boolean {
  return /^\d{6}$/.test(adcode);
}