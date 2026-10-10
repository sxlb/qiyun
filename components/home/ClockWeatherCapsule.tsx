"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  fetchWeatherShared,
  refreshWeather,
  subscribeWeather,
  type WeatherFetchResult,
  type WeatherPayload,
} from "@/lib/weatherClient";

// ===== 天气数据加载 Hook =====
// 走共享层（lib/weatherClient.ts）：欢迎通知也要用这次请求顺带解析出的访客地域，
// 两处共用同一次请求而不是各发一次。
//
// 除首次加载与 10 分钟定时重取之外，还订阅共享层的广播：用户在欢迎弹窗点
// 「使用精确位置」、或在本卡片点「刷新定位与天气」时，两处展示的位置与天气一起变。
// 少了这层订阅，用户在弹窗里定位成功后，时钟卡片仍显示旧城市 —— 看起来就像"定位没生效"。
function useWeather(precise: boolean): {
  data: WeatherPayload;
  error?: string;
  hint?: string;
  refreshing: boolean;
  refresh: () => Promise<WeatherFetchResult>;
} {
  const [data, setData] = useState<WeatherPayload>({});
  const [error, setError] = useState<string>();
  // 手动刷新后的补充说明（如"未能获取精确位置"）：与 error 分开，
  // 避免把「网络正常但定位被拒」说成网络故障
  const [hint, setHint] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let disposed = false;

    function apply(result: WeatherFetchResult) {
      if (disposed) return;
      if (result.data) {
        setData(result.data);
        // 恢复成功要清掉上一次的错误，否则失败过的提示会一直挂着
        setError(undefined);
      }
      if (result.error) setError(result.error);
    }

    async function load() {
      apply(await fetchWeatherShared({ precise }));
    }

    load();
    const timer = setInterval(load, 10 * 60 * 1000);
    const unsubscribe = subscribeWeather(apply);
    return () => {
      disposed = true;
      clearInterval(timer);
      unsubscribe();
      // 这里**不**需要处理在途请求：请求在共享层发起，不绑定本组件生命周期，
      // 因此开发模式 StrictMode 的「挂载→清理→再挂载」不会把它打断
    };
  }, [precise]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setHint(undefined);
    try {
      const result = await refreshWeather({ precise });
      // 开了精确定位开关却没拿到坐标 → 明确告知，否则用户只看到"转了一圈还是老位置"，
      // 会以为按钮坏了
      if (precise && !result.precise) {
        setHint("未能获取精确位置，请检查浏览器定位权限");
      }
      return result;
    } finally {
      setRefreshing(false);
    }
  }, [precise]);

  return { data, error, hint, refreshing, refresh };
}

// ===== 格式化辅助函数 =====
// 支持的日期占位符：YYYY 年 / YY 两位年 / MM 两位月 / M 月 / DD 两位日 / D 日 / dddd 中文星期
function formatDate(now: Date, fmt: string): string {
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const pad = (n: number) => n.toString().padStart(2, "0");
  const tokens: Record<string, string> = {
    YYYY: String(now.getFullYear()),
    YY: String(now.getFullYear()).slice(-2),
    MM: pad(now.getMonth() + 1),
    M: String(now.getMonth() + 1),
    DD: pad(now.getDate()),
    D: String(now.getDate()),
    dddd: weekdays[now.getDay()],
  };
  // 长 token 优先替换，避免 "MM" 被 "M" 先匹配
  let out = fmt || "YYYY年M月D日 dddd";
  Object.keys(tokens)
    .sort((a, b) => b.length - a.length)
    .forEach((k) => {
      out = out.split(k).join(tokens[k]);
    });
  return out;
}

function formatTime(now: Date, format: string, showSeconds: boolean): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  const seconds = showSeconds ? `:${pad(now.getSeconds())}` : "";
  if (format === "12") {
    // 12 小时制补时段后缀，避免 "06:30" 早晚歧义
    const period = now.getHours() >= 12 ? "PM" : "AM";
    const h = now.getHours() % 12 || 12;
    return `${pad(h)}:${pad(now.getMinutes())}${seconds} ${period}`;
  }
  return `${pad(now.getHours())}:${pad(now.getMinutes())}${seconds}`;
}

export default function ClockWeatherCapsule({
  timeFormat = "24",
  showSeconds = true,
  dateFormat = "YYYY年M月D日 dddd",
  preciseLocation = false,
}: {
  /** 时钟格式：24 小时制 / 12 小时制 */
  timeFormat?: string;
  /** 是否显示秒 */
  showSeconds?: boolean;
  /** 日期格式（YYYY/YY/MM/M/DD/D/dddd） */
  dateFormat?: string;
  /** 是否启用浏览器精确定位（后台开关；开启时由本组件发起定位授权请求） */
  preciseLocation?: boolean;
}) {
  // 时钟/日期 ref 直写：1s 间隔仅更新 DOM 文本，不触发 React re-render，
  // 天气卡片（独立 state）不受每秒 tick 影响（避免整卡每秒重渲染）
  const timeRef = useRef<HTMLSpanElement>(null);
  const dateRef = useRef<HTMLDivElement>(null);

  const { data, error: weatherError, hint, refreshing, refresh } = useWeather(preciseLocation);
  const { city, weather, temperature, winddirection, windpower } = data;

  // 每秒更新时钟与日期（ref 直写 DOM，无 state 变更）
  useEffect(() => {
    const update = () => {
      const now = new Date();
      if (dateRef.current) {
        dateRef.current.textContent = formatDate(now, dateFormat || "YYYY年M月D日 dddd");
      }
      if (timeRef.current) {
        timeRef.current.textContent = formatTime(now, timeFormat || "24", showSeconds ?? true);
      }
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [timeFormat, showSeconds, dateFormat]);

  const dir = (winddirection || "").endsWith("风")
    ? winddirection!
    : `${winddirection || ""}风`;
  const power = (windpower || "").endsWith("级")
    ? windpower!
    : `${windpower || ""}级`;

  return (
       <div className="relative flex h-full w-full flex-col justify-end">
         {/* 刷新按钮（定位 + 天气一体）：自动定位不准时的唯一手动入口。
             放在卡片右上角 —— 时钟与天气都居中排布，右侧是空白区，不会压到任何文字。
             一个按钮同时做两件事，避免"刷新了定位但天气没变"这类半生效状态。 */}
         <button
           type="button"
           onClick={() => void refresh()}
           disabled={refreshing}
           title="刷新定位与天气"
           aria-label="刷新定位与天气"
           className="absolute right-0 top-0 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white/60 transition-colors hover:bg-white/20 hover:text-white/90 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-white/60 disabled:cursor-default disabled:bg-white/10 disabled:text-white/35"
         >
           <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} aria-hidden />
         </button>

         {/* 时钟+天气合并为一个紧凑组 */}
         <div className="flex flex-col items-center gap-1.5">
           {/* 日期行 — 移动端 12px，桌面端（md+）14px 提升可读性 */}
           <div ref={dateRef} className="text-center text-[12px] tracking-[0.2em] text-white/50 md:text-[14px]">
             --
           </div>

           {/* 时间（容器查询自适应，字号随卡片宽度缩放；按时间制区分：
                24 小时制文本短，用较大字号；12 小时制含 AM/PM 更长，用较小字号避免溢出） */}
           <div className="flex items-center justify-center">
             <span
               ref={timeRef}
               className={`font-clock leading-none tracking-wider text-white/85 ${
                 timeFormat === "12"
                   ? "text-[clamp(27px,12cqw,42px)]"
                   : "text-[clamp(32px,19cqw,56px)]"
               }`}
            >
              --:--
            </span>
          </div>

           {/* 天气信息 */}
           <div className="flex flex-col items-center gap-1.5 text-center">
             {/* 城市名 */}
             <div className="overflow-hidden whitespace-nowrap text-[15px] tracking-wide text-white/70">
               {city || "--"}
             </div>

             {/* 天气 + 温度 + 风向。
                这一行允许换行（原来是 nowrap + overflow-hidden 的单行）：风向是最后一个元素，
                单行放不下时被裁掉的只会是它，所以早先干脆在 <640px 整块隐藏 —— 代价是手机上
                永远看不到风。改成换行后，风向在窄屏独占第二行，既不裁剪也不会挤掉天气与温度；
                ≥sm 宽度够，仍旧是原来的一行。 */}
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 overflow-hidden">
              <span className="whitespace-nowrap text-[15px] text-white/60">{weather || "--"}</span>
              <span className="opacity-30">·</span>
              <span className="whitespace-nowrap text-lg font-semibold">{temperature || "--"}</span>
              {/* 风向折到第二行时，这个分隔点不该孤零零留在上一行末尾 */}
              <span className="opacity-30 max-sm:hidden">·</span>
              <span className="flex items-center gap-1 whitespace-nowrap text-[13px] text-white/50">
                <WindIcon className="h-4 w-4 shrink-0" />
                {dir} {power}
              </span>
            </div>
           </div>
         </div>

      {/* 提示优先级：定位类说明（hint）比网络错误更具体、更可操作，先展示它 */}
      {(hint || weatherError) && (
        <p className="text-center text-xs text-white/60">{hint || weatherError}</p>
      )}
    </div>
  );
}

// 简单 Wind 图标组件
function WindIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2" />
      <path d="M9.6 4.6A2 2 0 1 1 11 8H2" />
      <path d="M12.6 19.4A2 2 0 1 0 14 16H2" />
    </svg>
  );
}
