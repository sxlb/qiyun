"use client";

import { useEffect, useRef, useState } from "react";

// ===== 天气数据加载 Hook =====
interface WeatherData {
  city?: string;
  weather?: string;
  temperature?: string;
  winddirection?: string;
  windpower?: string;
}

function useWeather(): { data: WeatherData; error?: string } {
  const [data, setData] = useState<WeatherData>({});
  const [error, setError] = useState<string>();

  useEffect(() => {
    let disposed = false;
    // 每次请求使用独立的 AbortController 与超时定时器。
    // 此前整个 effect 只建一个 controller 并只用一次 8 秒定时器 abort()：
    // 挂载满 8 秒后它必然处于 aborted 状态，之后 10 分钟一次的轮询 fetch
    // 会立刻抛 AbortError 并被静默吞掉 —— 天气永远不会再刷新。
    let inflight: AbortController | null = null;

    async function load() {
      inflight = new AbortController();
      const timeoutTimer = setTimeout(() => inflight?.abort(), 8000);
      try {
        const res = await fetch("/api/weather", { signal: inflight.signal });
        if (disposed) return;
        if (res.ok) {
          const json = await res.json();
          if (!disposed) {
            setData(json);
            // 恢复成功要清掉上一次的错误，否则失败过的提示会一直挂着
            setError(undefined);
          }
        } else {
          setError("天气数据获取失败");
        }
      } catch (e) {
        // abort signal 触发时忽略错误
        if (e instanceof Error && e.name === "AbortError") return;
        if (!disposed) setError("网络错误");
      } finally {
        clearTimeout(timeoutTimer);
      }
    }

    load();
    const timer = setInterval(load, 10 * 60 * 1000);
    return () => {
      disposed = true;
      clearInterval(timer);
      inflight?.abort();
    };
  }, []);

  return { data, error };
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
}: {
  /** 时钟格式：24 小时制 / 12 小时制 */
  timeFormat?: string;
  /** 是否显示秒 */
  showSeconds?: boolean;
  /** 日期格式（YYYY/YY/MM/M/DD/D/dddd） */
  dateFormat?: string;
}) {
  // 时钟/日期 ref 直写：1s 间隔仅更新 DOM 文本，不触发 React re-render，
  // 天气卡片（独立 state）不受每秒 tick 影响（避免整卡每秒重渲染）
  const timeRef = useRef<HTMLSpanElement>(null);
  const dateRef = useRef<HTMLDivElement>(null);

  const { data, error: weatherError } = useWeather();
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
       <div className="flex h-full w-full flex-col justify-end">
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

             {/* 天气 + 温度 + 风向 */}
             <div className="flex items-center justify-center gap-3 overflow-hidden whitespace-nowrap">
               <span className="text-[15px] text-white/60">{weather || "--"}</span>
               <span className="opacity-30">·</span>
               <span className="text-lg font-semibold">{temperature || "--"}</span>
               <span className="opacity-30">·</span>
               <span className="hidden items-center gap-1 text-[13px] text-white/50 sm:flex">
                 <WindIcon className="h-4 w-4 shrink-0" />
                 {dir} {power}
               </span>
             </div>
           </div>
         </div>

      {weatherError && <p className="text-center text-xs text-white/60">{weatherError}</p>}
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
