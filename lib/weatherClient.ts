/**
 * 前端天气取数的共享层。
 *
 * 背景：首页有两处都需要「访客所在地」——
 *  1. 时钟天气胶囊（展示城市与天气）
 *  2. 欢迎通知（展示"来自 X · Y"）
 * 而天气接口在**未配置固定城市**时本来就会按访客定位，并把地域标签（`region`）一并返回。
 * 于是让两处共用同一次请求：省一次请求，且定位精度优于本地离线库。
 *
 * 定位依据有两种，由 `precise` 选项决定：
 * - **IP 定位**（默认）：服务端按 `X-Forwarded-For` 查 IP 库，读的是运营商登记地；
 * - **浏览器精确定位**（`precise: true`，后台开关控制）：先经 `lib/geolocation.ts` 取设备坐标，
 *   再把坐标带给接口做逆地理编码 —— 这是唯一能绕开「IP 登记在邻市」的手段。
 *   拿不到坐标（被拒绝/超时/不支持）时**静默退回** IP 定位，接口调用方无需区分。
 *
 * 只共享「在途请求」与「刚刚成功的短时结果」：
 * - 失败结果**不缓存** —— 缓存住失败会让后续调用者连重试的机会都没有
 * - 成功结果只复用 60 秒，远短于胶囊 10 分钟的重取间隔，因此不会展示过期天气
 *
 * 另外提供一层**极轻量的广播**：任一处拿到新数据就把结果推给所有订阅者。
 * 这是「用户在欢迎弹窗点了『使用精确位置』/ 点了时钟卡片的刷新按钮，但另一处纹丝不动」
 * 的解药 —— 两个组件各自持有一份 state，没有广播就永远对不上。
 *
 * 注意：这是客户端模块（依赖浏览器的 fetch 与相对路径），不要被服务端组件引入。
 */

import { requestPreciseCoords, clearPreciseCoords, type PreciseCoords } from "@/lib/geolocation";

export interface WeatherPayload {
  city?: string;
  weather?: string;
  temperature?: string;
  winddirection?: string;
  windpower?: string;
  /** 访客地域标签；仅「按访客定位」时返回（配置了固定城市时不返回） */
  region?: string;
}

export interface WeatherFetchResult {
  /** 成功时的数据；失败为 null */
  data: WeatherPayload | null;
  /** 失败提示文案；成功与「8 秒超时」时为 undefined（超时不当作错误，见下） */
  error?: string;
  /** 本次请求是否真的带上了浏览器精确定位坐标（供欢迎弹窗决定要不要显示「使用精确位置」） */
  precise?: boolean;
}

export interface FetchWeatherOptions {
  /** 是否允许使用浏览器精确定位（由后台开关下发；未开启时完全不碰 geolocation） */
  precise?: boolean;
  /** 忽略缓存与「曾被拒绝」的记忆，用于用户主动点击「使用精确位置」后的重取 */
  force?: boolean;
}

/** 成功结果的复用窗口：够覆盖两个组件先后挂载，又短到不会展示过期天气 */
const SHARE_TTL_MS = 60 * 1000;
/** 单次请求超时（与改造前保持一致） */
const REQUEST_TIMEOUT_MS = 8000;

/** 缓存/在途请求的区分键：有坐标按坐标（3 位小数），否则为空串（IP 定位） */
function locateKey(coords: PreciseCoords | null): string {
  return coords ? `${coords.lng.toFixed(3)},${coords.lat.toFixed(3)}` : "";
}

let inflight: { key: string; promise: Promise<WeatherFetchResult> } | null = null;
let cached: { at: number; key: string; data: WeatherPayload; precise: boolean } | null = null;

/* ---------------- 轻量广播：一处拿到新数据，所有消费方一起更新 ---------------- */

type WeatherListener = (result: WeatherFetchResult) => void;

const listeners = new Set<WeatherListener>();

/**
 * 订阅天气更新。返回取消订阅函数（组件卸载时调用）。
 *
 * 触发时机：某次请求**真正拿到响应**之后（含成功与失败）。
 * 刻意不在命中短时缓存时广播 —— 那种情况下调用方本来就已经同步拿到了结果，
 * 再广播一次只会让各组件白跑一次 setState。
 */
export function subscribeWeather(listener: WeatherListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 逐个通知订阅者；单个订阅者抛错不能连累其余订阅者（组件里的 bug 不该拖垮整页天气） */
function emit(result: WeatherFetchResult): void {
  for (const listener of listeners) {
    try {
      listener(result);
    } catch {
      // 忽略：订阅方自身的异常由它自己负责
    }
  }
}

async function request(coords: PreciseCoords | null): Promise<WeatherFetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const precise = coords !== null;
  try {
    const url = precise ? `/api/weather?lng=${coords!.lng}&lat=${coords!.lat}` : "/api/weather";
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return { data: null, error: "天气数据获取失败", precise };
    const data = (await res.json()) as WeatherPayload;
    cached = { at: Date.now(), key: locateKey(coords), data, precise };
    const result: WeatherFetchResult = { data, precise };
    emit(result);
    return result;
  } catch (e) {
    // 超时（AbortError）不报错：与共享前胶囊的行为一致 —— 慢网络下弹一句"网络错误"没有意义，
    // 何况欢迎通知那边只要拿得到 region 就够了
    if (e instanceof Error && e.name === "AbortError") return { data: null, precise };
    return { data: null, error: "网络错误", precise };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 取天气数据：并发去重 + 短时复用。**永不抛异常**，失败时 `data` 为 null 并带 `error`。
 *
 * 请求本身不绑定任何组件的生命周期，因此不存在「组件卸载把在途请求打断」的问题
 * （改造前胶囊里那段"不要在清理时 abort"的说明，现在由这一层天然满足）。
 */
export async function fetchWeatherShared(opts: FetchWeatherOptions = {}): Promise<WeatherFetchResult> {
  const coords = opts.precise ? await requestPreciseCoords(opts.force ?? false) : null;
  const key = locateKey(coords);

  if (!opts.force && cached && cached.key === key && Date.now() - cached.at < SHARE_TTL_MS) {
    return { data: cached.data, precise: cached.precise };
  }
  // 在途去重只在「定位依据相同」时生效：坐标与 IP 是两次不同的请求，不能互相顶替。
  // force（用户主动刷新）时一律不复用：手动刷新要的正是"重新走一遍"，
  // 复用一个按旧依据发起的在途请求会让按钮看起来没反应。
  if (!opts.force && inflight && inflight.key === key) return inflight.promise;

  const promise = request(coords).finally(() => {
    if (inflight?.promise === promise) inflight = null;
  });
  inflight = { key, promise };
  return promise;
}

export interface RefreshWeatherOptions {
  /** 是否启用浏览器精确定位（后台「浏览器精确定位」开关）：开启时同时强制重新定位 */
  precise?: boolean;
}

/**
 * 「刷新定位 + 刷新天气」的统一入口（时钟卡片的刷新按钮、欢迎弹窗的「使用精确位置」共用）。
 *
 * 一次调用做完三件事：
 * 1. 作废旧坐标（仅当启用精确定位）—— 否则 `requestPreciseCoords` 会把旧坐标原样返回；
 * 2. 作废短时缓存并强制重取，忽略「曾被拒绝」的记忆，重新走一遍定位授权；
 * 3. 请求成功后由 `request` 广播给所有订阅者，两个组件的位置与天气一起刷新。
 *
 * 永不抛异常；被拒绝/超时时 `precise` 为 false，调用方可据此提示用户检查浏览器权限。
 */
export async function refreshWeather(opts: RefreshWeatherOptions = {}): Promise<WeatherFetchResult> {
  cached = null;
  if (opts.precise) clearPreciseCoords();
  return fetchWeatherShared({ precise: opts.precise ?? false, force: true });
}

/** 供测试清空共享状态，保证用例隔离（模块级缓存不清会串场） */
export function resetWeatherShare(): void {
  inflight = null;
  cached = null;
  listeners.clear();
}