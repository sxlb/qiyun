/**
 * 浏览器精确定位（`navigator.geolocation`）的客户端封装。
 *
 * 为什么需要它：IP 定位读的是**运营商 IP 池的登记地**，登记在邻市就会一直显示错
 * （实测：泰州的电信出口 IP 被登记在盐城）。坐标由设备给出，是唯一能绕开这一层的手段。
 *
 * 四条约束：
 * - 浏览器只在安全上下文（HTTPS / localhost）提供该能力，`navigator.geolocation` 缺失时直接放弃；
 * - 一次挂载内**并发去重**：首页时钟胶囊与欢迎弹窗会同时要位置，不能弹两次权限框；
 * - 拿到坐标后**落盘复用**（见 `COORDS_TTL_MS`）：刷新页面直接用上次的位置，
 *   不再依赖浏览器每次都重新定位 —— 这是「刷新后位置又变回去」的根因所在；
 * - 被拒绝后**记住**，不再自动请求（否则每次进站都弹一次，很烦），但保留 `force`
 *   供用户主动点击「刷新定位」或欢迎弹窗的「使用精确位置」再次尝试。
 */

export interface PreciseCoords {
  lng: number;
  lat: number;
}

/**
 * 被拒绝过的记忆键（localStorage）：只用于"不再自动请求"，用户手动点按钮仍可重试。
 *
 * 键名带 `-v2`：0.0.14 期间站点响应头把定位写成了 `geolocation=()`，浏览器**静默**拒绝
 * （不弹授权框，直接回调 PERMISSION_DENIED），于是被记下的"拒绝"其实是假拒绝。
 * 换键名让这批历史标记作废，访客在修复后能重新自动请求一次；否则他们会继续停在
 * 「不弹窗、按钮点了才动」的状态里，看起来像没修。
 */
const DENIED_KEY = "qiyun-precise-location-denied-v2";

/**
 * 坐标缓存键（localStorage）：把上次拿到的坐标连同时间戳写盘。
 *
 * 键名带 `-v1`：将来若坐标语义（数组 vs 对象、精度）有变更，换键名即可整体作废。
 */
const COORDS_KEY = "qiyun-precise-coords-v1";

/**
 * 坐标复用窗口：30 分钟。
 *
 * 取值理由：够覆盖「刷新页面 / 切走标签页再回来」这类最频繁的场景（用户抱怨的正是
 * 刷新后又要重新定位），又不至于让用户在通勤路上换了城市还一直看到出发地的天气。
 * 超期后重新定位 —— 浏览器权限已授予时这一步是静默的，不会二次弹框，因此代价很低。
 */
const COORDS_TTL_MS = 30 * 60 * 1000;

/** 定位超时：超过这个时间还没结果就放弃，不能拖住首屏天气 */
const LOCATE_TIMEOUT_MS = 6000;

/** 落盘结构：坐标 + 取得时刻（时间戳用于 TTL 判定） */
interface StoredCoords extends PreciseCoords {
  at: number;
}

let coords: PreciseCoords | null = null;
/** 是否已尝试过"从 localStorage 恢复"：避免每次调用都读盘（隐私模式下会反复抛异常） */
let restored = false;
let inflight: Promise<PreciseCoords | null> | null = null;

/** 是否为合法坐标（数字、有限值；lat/lng 的取值边界由浏览器保证，这里只挡脏数据） */
function isValidCoords(lng: unknown, lat: unknown): boolean {
  return (
    typeof lng === "number" &&
    typeof lat === "number" &&
    Number.isFinite(lng) &&
    Number.isFinite(lat)
  );
}

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

function removeStoredCoords(): void {
  try {
    localStorage.removeItem(COORDS_KEY);
  } catch {
    // 隐私模式：内存已清，行为仍符合预期
  }
}

/**
 * 从 localStorage 恢复坐标。
 *
 * 任何不可用的落盘内容（读不到 / 不是合法 JSON / 字段缺失 / 已过期）都返回 null，
 * 并顺手把坏数据清掉 —— 否则它会一直躺在那里，每次进站都白解析一遍。
 */
function readStoredCoords(): PreciseCoords | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(COORDS_KEY);
  } catch {
    return null; // 读不到（隐私模式 / 存储被禁）：视为没有缓存
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredCoords>;
    if (
      isValidCoords(parsed.lng, parsed.lat) &&
      typeof parsed.at === "number" &&
      Date.now() - parsed.at <= COORDS_TTL_MS
    ) {
      return { lng: parsed.lng as number, lat: parsed.lat as number };
    }
  } catch {
    // 解析失败：按脏数据处理，走下面的统一清理
  }

  removeStoredCoords();
  return null;
}

function writeStoredCoords(next: PreciseCoords): void {
  try {
    const doc: StoredCoords = { ...next, at: Date.now() };
    localStorage.setItem(COORDS_KEY, JSON.stringify(doc));
  } catch {
    // 写不进去不影响本次会话使用：退化为"仅内存有效"
  }
}

/**
 * 当前可用坐标（惰性恢复一次）。
 *
 * 刻意不在模块顶层读 localStorage：模块会被客户端组件引入，而 SSR 阶段没有 localStorage，
 * 顶层读取会直接抛错；惰性读取把时机推迟到真正需要坐标的调用点。
 */
function currentCoords(): PreciseCoords | null {
  if (!restored) {
    restored = true;
    coords = readStoredCoords();
  }
  return coords;
}

/** 本次会话是否已拿到坐标（供组件判断要不要显示「使用精确位置」按钮） */
export function hasPreciseCoords(): boolean {
  return currentCoords() !== null;
}

/**
 * 清掉坐标缓存（内存 + localStorage）。
 *
 * 用于用户主动点「刷新定位」：既然是要重新定位，就必须先把旧坐标作废，
 * 否则 `requestPreciseCoords` 会直接把旧坐标原样返回，按钮点了等于没点。
 */
export function clearPreciseCoords(): void {
  coords = null;
  restored = true;
  removeStoredCoords();
}

/**
 * 请求精确定位。**永不抛异常**，失败/拒绝/不支持都返回 null。
 *
 * @param force 忽略「曾被拒绝」的记忆与已缓存坐标，用于用户主动点击刷新的场景
 */
export function requestPreciseCoords(force = false): Promise<PreciseCoords | null> {
  const cached = currentCoords();
  // 非强制时优先复用（含刷新页面后从 localStorage 恢复的坐标）：
  // 这正是"刷新后不再重复定位"的落点
  if (!force && cached) return Promise.resolve(cached);
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
        restored = true;
        // 立刻落盘：这样用户下一次刷新页面能直接复用，而不必再走一遍定位
        writeStoredCoords(coords);
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
        // 允许复用 10 分钟内的浏览器缓存位置：同一访客反复刷新不必每次都定位
        maximumAge: 10 * 60 * 1000,
      }
    );
  }).finally(() => {
    inflight = null;
  });

  return inflight;
}
