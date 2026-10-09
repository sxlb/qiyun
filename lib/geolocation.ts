/**
 * 浏览器精确定位（`navigator.geolocation`）的客户端封装。
 *
 * 为什么需要它：IP 定位读的是**运营商 IP 池的登记地**，登记在邻市就会一直显示错
 * （实测：泰州的电信出口 IP 被登记在盐城）。坐标由设备给出，是唯一能绕开这一层的手段。
 *
 * 三条约束：
 * - 浏览器只在安全上下文（HTTPS / localhost）提供该能力，`navigator.geolocation` 缺失时直接放弃；
 * - 一次挂载内**并发去重**：首页时钟胶囊与欢迎弹窗会同时要位置，不能弹两次权限框；
 * - 被拒绝后**记住**，不再自动请求（否则每次进站都弹一次，很烦），但保留 `force`
 *   供欢迎弹窗的「使用精确位置」按钮再次尝试。
 */

export interface PreciseCoords {
  lng: number;
  lat: number;
}

/** 被拒绝过的记忆键（localStorage）：只用于"不再自动请求"，用户手动点按钮仍可重试 */
const DENIED_KEY = "qiyun-precise-location-denied";
/** 定位超时：超过这个时间还没结果就放弃，不能拖住首屏天气 */
const LOCATE_TIMEOUT_MS = 6000;

let coords: PreciseCoords | null = null;
let inflight: Promise<PreciseCoords | null> | null = null;

function readDenied(): boolean {
  try {
    return localStorage.getItem(DENIED_KEY) === "1";
  } catch {
    return false;
  }
}

function markDenied(): void {
  try {
    localStorage.setItem(DENIED_KEY, "1");
  } catch {
    // 隐私模式下 localStorage 不可写：退化为"不记忆"，每次进站仍会尝试一次
  }
}

/** 本次会话是否已拿到坐标（供组件判断要不要显示「使用精确位置」按钮） */
export function hasPreciseCoords(): boolean {
  return coords !== null;
}

/**
 * 请求精确定位。**永不抛异常**，失败/拒绝/不支持都返回 null。
 *
 * @param force 忽略「曾被拒绝」的记忆，用于用户主动点击按钮的场景
 */
export function requestPreciseCoords(force = false): Promise<PreciseCoords | null> {
  if (coords) return Promise.resolve(coords);
  if (!force && readDenied()) return Promise.resolve(null);
  if (inflight) return inflight;

  inflight = new Promise<PreciseCoords | null>((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        coords = { lng: pos.coords.longitude, lat: pos.coords.latitude };
        resolve(coords);
      },
      () => {
        // 拒绝与超时都会走到这里。两者都记为"拒绝"：自动请求不该反复打扰，
        // 用户真想用精确位置时还有按钮。
        markDenied();
        resolve(null);
      },
      {
        // 不启用高精度：WiFi/基站级定位已足够到区县，启用 GPS 会明显变慢且耗电。
        // 桌面端没有 GPS，浏览器会用 WiFi 数据库、必要时回落到 IP —— 那条回退路径
        // 拿到的其实还是 IP 登记地，属于该方案的固有局限（见 docs/API.md）。
        enableHighAccuracy: false,
        timeout: LOCATE_TIMEOUT_MS,
        // 允许复用 10 分钟内的缓存位置：同一访客反复刷新不必每次都定位
        maximumAge: 10 * 60 * 1000,
      }
    );
  }).finally(() => {
    inflight = null;
  });

  return inflight;
}