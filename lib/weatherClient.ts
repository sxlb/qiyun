/**
 * 前端天气取数的共享层。
 *
 * 背景：首页有两处都需要「访客所在地」——
 *  1. 时钟天气胶囊（展示城市与天气）
 *  2. 欢迎通知（展示"来自 X · Y"）
 * 而天气接口在**未配置固定城市**时本来就会按访客 IP 定位，并把地域标签（`region`）一并返回。
 * 于是让两处共用同一次请求：省一次请求，且定位来自腾讯/高德的 IP 库，境内精度优于本地离线库。
 *
 * 只共享「在途请求」与「刚刚成功的短时结果」：
 * - 失败结果**不缓存** —— 缓存住失败会让后续调用者连重试的机会都没有
 * - 成功结果只复用 60 秒，远短于胶囊 10 分钟的重取间隔，因此不会展示过期天气
 *
 * 注意：这是客户端模块（依赖浏览器的 fetch 与相对路径），不要被服务端组件引入。
 */

export interface WeatherPayload {
  city?: string;
  weather?: string;
  temperature?: string;
  winddirection?: string;
  windpower?: string;
  /** 访客地域标签；仅「按访客 IP 自动定位」时返回（配置了固定城市时不返回） */
  region?: string;
}

export interface WeatherFetchResult {
  /** 成功时的数据；失败为 null */
  data: WeatherPayload | null;
  /** 失败提示文案；成功与「8 秒超时」时为 undefined（超时不当作错误，见下） */
  error?: string;
}

/** 成功结果的复用窗口：够覆盖两个组件先后挂载，又短到不会展示过期天气 */
const SHARE_TTL_MS = 60 * 1000;
/** 单次请求超时（与改造前保持一致） */
const REQUEST_TIMEOUT_MS = 8000;

let inflight: Promise<WeatherFetchResult> | null = null;
let cached: { at: number; data: WeatherPayload } | null = null;

async function request(): Promise<WeatherFetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch("/api/weather", { signal: controller.signal });
    if (!res.ok) return { data: null, error: "天气数据获取失败" };
    const data = (await res.json()) as WeatherPayload;
    cached = { at: Date.now(), data };
    return { data };
  } catch (e) {
    // 超时（AbortError）不报错：与共享前胶囊的行为一致 —— 慢网络下弹一句"网络错误"没有意义，
    // 何况欢迎通知那边只要拿得到 region 就够了
    if (e instanceof Error && e.name === "AbortError") return { data: null };
    return { data: null, error: "网络错误" };
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
export function fetchWeatherShared(): Promise<WeatherFetchResult> {
  if (cached && Date.now() - cached.at < SHARE_TTL_MS) {
    return Promise.resolve({ data: cached.data });
  }
  if (inflight) return inflight;
  inflight = request().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** 供测试清空共享状态，保证用例隔离（模块级缓存不清会串场） */
export function resetWeatherShare(): void {
  inflight = null;
  cached = null;
}
