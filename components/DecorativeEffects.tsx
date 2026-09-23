"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

/**
 * ===== 页面装饰/工具类效果组件合集 =====
 *
 * 5 个"enabled 开关 + 返回 null/占位"的客户端效果组件（点击粒子 / 控制台彩蛋 /
 * 动态标题 / 顶部进度条 / 欢迎通知），功能独立但形态高度一致，合并为单文件：
 * - 各子组件仍以具名导出暴露，便于单测与按需引用
 * - 默认导出 Effects 组合组件，供首页一处挂载全部装饰效果
 * 该文件由页面懒加载（ssr:false）：LoadingScreen 收起后再加载；
 * 后台全部关闭时此 chunk 零下载。
 */

/* ==================== 点击粒子特效 ==================== */

interface ClickEffectProps {
  /** 是否启用（后台可配置） */
  enabled?: boolean;
}

interface Particle {
  el: HTMLSpanElement;
  x: number;
  y: number;
}

// 莫兰迪色系（低饱和度、高级感）
const CLICK_COLORS = [
  "#d4a0a0", // 灰玫瑰粉
  "#c9c0a3", // 砂岩米黄
  "#94b5a0", // 薄荷灰绿
  "#8fa8c9", // 雾霭蓝灰
  "#c4a882", // 驼金棕
  "#b5a0be", // 薰衣草灰紫
];

/**
 * 点击粒子特效：点击页面任意位置，在鼠标处绽放彩色粒子（圆点 + 爱心交替）
 * 粒子从中心向四周扩散并淡出，动画结束后自动移除 DOM，性能友好
 */
export function ClickEffect({ enabled = true }: ClickEffectProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const particlesRef = useRef<Particle[]>([]);

  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;

    const spawn = (e: PointerEvent) => {
      // 忽略非鼠标/触摸主键
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const count = 8;
      for (let i = 0; i < count; i++) {
        const el = document.createElement("span");
        const heart = i % 3 === 0; // 每三个出一个爱心
        const size = heart ? 12 + Math.random() * 8 : 6 + Math.random() * 6;
        const color = CLICK_COLORS[Math.floor(Math.random() * CLICK_COLORS.length)];
        el.className = "pointer-events-none absolute";
        el.style.width = `${size}px`;
        el.style.height = `${size}px`;
        el.style.backgroundColor = heart ? "transparent" : color;
        el.style.borderRadius = heart ? "0" : "50%";
        if (heart) {
          // CSS 爱心：旋转 45° 方块 + 两个伪元素圆
          el.style.transform = "rotate(45deg)";
          el.style.background = color;
          const before = document.createElement("i");
          const after = document.createElement("i");
          before.style.cssText = `content:'';position:absolute;width:100%;height:100%;border-radius:50%;background:${color};left:0;top:-50%;`;
          after.style.cssText = `content:'';position:absolute;width:100%;height:100%;border-radius:50%;background:${color};left:-50%;top:0;`;
          el.appendChild(before);
          el.appendChild(after);
        }
        container.appendChild(el);

        const x = e.clientX + (Math.random() - 0.5) * 60;
        const y = e.clientY + (Math.random() - 0.5) * 60;
        el.style.left = `${e.clientX}px`;
        el.style.top = `${e.clientY}px`;

        const particle: Particle = { el, x, y };
        particlesRef.current.push(particle);

        // 用 rAF 触发过渡动画
        requestAnimationFrame(() => {
          el.style.transition =
            "transform 0.6s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.6s ease";
          el.style.transform = `translate(${x - e.clientX}px, ${y - e.clientY}px) rotate(${Math.random() * 180}deg)`;
          el.style.opacity = "0";
        });

        // 动画结束移除
        setTimeout(() => {
          el.remove();
          const idx = particlesRef.current.indexOf(particle);
          if (idx !== -1) particlesRef.current.splice(idx, 1);
        }, 650);
      }
    };

    window.addEventListener("pointerdown", spawn);
    return () => {
      window.removeEventListener("pointerdown", spawn);
      particlesRef.current.forEach((p) => p.el.remove());
      particlesRef.current = [];
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div
      ref={containerRef}
      className="pointer-events-none fixed inset-0 z-[80] overflow-hidden"
      aria-hidden
    />
  );
}

/* ==================== 控制台彩蛋 ==================== */

interface DevConsoleProps {
  /** 是否启用（后台可配置） */
  enabled?: boolean;
  /** 站点名 */
  siteName?: string;
}

/**
 * 控制台彩蛋：打开浏览器 DevTools 时输出 ASCII 艺术字 + 版权信息
 * 彩色输出使用 6 种颜色分别对应 ASCII 字的 6 行，模拟彩虹渐变效果
 */
export function DevConsole({ enabled = true, siteName = "" }: DevConsoleProps) {
  useEffect(() => {
    if (!enabled) return;
    const name = siteName || "个人主页";
    const art = String.raw`
 ██████╗ ██████╗ ██╗   ██╗███████╗██╗  ██║
██╔════╝ ██╔══██╗██║   ██║██╔════╝██║  ██║
██║  ███╗██████╔╝██║   ██║█████╗  ███████║
██║   ██║██╔══██╗██║   ██║██╔══╝  ██╔══██║
╚██████╔╝██████╔╝╚██████╔╝███████╗██║  ██║
 ╚═════╝ ╚═════╝  ╚═════╝ ╚══════╝╚═╝  ╚═╝
`;
    const lines = art.split("\n");
    // 6 种柔和颜色对应 ASCII 字的 6 行（从上到下）
    const colors = [
      "#c4898e", // 灰玫瑰红
      "#c9b990", // 暖沙色
      "#8aad93", // 橄榄绿
      "#7a9bb5", // 雾霾蓝
      "#9d8bb1", // 淡紫灰
      "#b89f6a", // 暗金色
    ];
    console.log(
      `%c${lines[0]}%c${lines[1]}%c${lines[2]}%c${lines[3]}%c${lines[4]}%c${lines[5]}`,
      ...colors.flatMap((c) => [`color: ${c}; font-weight: bold;`])
    );
    console.log(
      `%c ${name} %c 欢迎访问！`,
      "background:#4d96ff;color:#fff;font-weight:bold;padding:4px 10px;border-radius:4px 0 0 4px;",
      "background:#333;color:#fff;padding:4px 10px;border-radius:0 4px 4px 0;"
    );
    console.log(
      "%c本页面为个人主页项目，未经授权请勿整站抄袭，保留作者信息。",
      "color:#999;font-size:12px;"
    );
  }, [enabled, siteName]);

  return null;
}

/* ==================== 动态页面标题 ==================== */

interface DynamicTitleProps {
  /** 是否启用（后台可配置） */
  enabled?: boolean;
  /** 站点名 */
  siteName?: string;
}

interface TrackDetail {
  name: string;
  artist: string;
}

/**
 * 动态页面标题：
 * - 无音乐播放时：按时间段显示问候语（早上好/下午好/晚上好）+ 站点名
 * - 播放音乐时：显示「♪ 歌名 - 歌手 - 站点名」
 * - 由 MusicPlayer 广播 music-track-change 事件联动
 */
export function DynamicTitle({ enabled = true, siteName = "" }: DynamicTitleProps) {
  useEffect(() => {
    if (!enabled) return;
    const name = siteName || "个人主页";

    const greeting = () => {
      const h = new Date().getHours();
      if (h >= 5 && h < 9) return "早上好";
      if (h >= 9 && h < 12) return "上午好";
      if (h >= 12 && h < 18) return "下午好";
      if (h >= 18 && h < 23) return "晚上好";
      return "夜深了";
    };

    let track: TrackDetail | null = null;
    const applyTitle = () => {
      if (track) {
        document.title = `${track.name} - ${track.artist} - ${name}`;
      } else {
        document.title = `${greeting()}，欢迎访问 ${name}`;
      }
    };

    const onTrack = (e: Event) => {
      const detail = (e as CustomEvent<TrackDetail>).detail;
      if (detail?.name) track = detail;
      else track = null;
      applyTitle();
    };
    const onReset = () => {
      track = null;
      applyTitle();
    };

    applyTitle();
    window.addEventListener("music-track-change", onTrack);
    window.addEventListener("music-player-close", onReset);
    const tick = window.setInterval(applyTitle, 60_000); // 每分钟刷新问候语
    return () => {
      window.removeEventListener("music-track-change", onTrack);
      window.removeEventListener("music-player-close", onReset);
      window.clearInterval(tick);
      document.title = name;
    };
  }, [enabled, siteName]);

  return null;
}

/* ==================== 顶部音乐进度条 ==================== */

interface TopProgressBarProps {
  /** 是否启用（后台可配置） */
  enabled?: boolean;
}

interface ProgressDetail {
  currentTime: number;
  duration: number;
  playing: boolean;
}

/**
 * 顶部音乐进度条（对应 home 项目的 ProgressBar.vue）：
 * - 顶部 2px 细条，按播放进度填充紫色
 * - 鼠标移入底部页脚区域时显示可拖拽手柄，拖动跳转播放进度
 * - 由 MusicPlayer 广播 music-progress 事件联动
 */
export function TopProgressBar({ enabled = true }: TopProgressBarProps) {
  const [pct, setPct] = useState(0);
  const [duration, setDuration] = useState(0);
  const [visible, setVisible] = useState(false);
  const draggingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // 监听播放进度事件；音频元素在进度事件中惰性获取（首次触发后缓存，之后复用）
  useEffect(() => {
    if (!enabled) return;
    const onProgress = (e: Event) => {
      const detail = (e as CustomEvent<ProgressDetail>).detail;
      if (!detail) return;
      setDuration(detail.duration || 0);
      if (!draggingRef.current) {
        setPct(detail.duration ? (detail.currentTime / detail.duration) * 100 : 0);
      }
      // 惰性获取：首次收到进度事件时获取 <audio> 引用，后续直接使用缓存
      if (!audioRef.current) {
        audioRef.current = document.getElementById("music-audio") as HTMLAudioElement | null;
      }
    };
    window.addEventListener("music-progress", onProgress);
    return () => window.removeEventListener("music-progress", onProgress);
  }, [enabled]);

  // 拖拽兜底：若鼠标按住后在进度条之外松开（onMouseUp 不触发），
  // 通过全局 mouseup/pointerup/dragend 复位拖拽态，避免进度被误判为持续拖动
  useEffect(() => {
    if (!enabled) return;
    const endDrag = () => {
      draggingRef.current = false;
    };
    window.addEventListener("mouseup", endDrag);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("dragend", endDrag);
    return () => {
      window.removeEventListener("mouseup", endDrag);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("dragend", endDrag);
    };
  }, [enabled]);

  const seekTo = (clientX: number, barRect: DOMRect) => {
    if (!duration) return;
    const ratio = Math.min(1, Math.max(0, (clientX - barRect.left) / barRect.width));
    const time = ratio * duration;
    setPct(ratio * 100);
    if (audioRef.current) audioRef.current.currentTime = time;
    // 广播进度，让播放器同步
    window.dispatchEvent(new CustomEvent("music-seek", { detail: { currentTime: time } }));
  };

  if (!enabled) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[70] h-1 cursor-pointer group" title="音乐播放进度">
      {/* 底层轨道 */}
      <div className="absolute inset-0 bg-white/10" />
      {/* 进度填充 */}
      <div
        className="absolute inset-y-0 left-0 bg-gradient-to-r from-purple-500 to-pink-500"
        style={{ width: `${pct}%` }}
      />
      {/* 进度条区域：鼠标悬停显示手柄，可拖动跳转 */}
      <div
        className="progress-interactive absolute inset-0 group-hover:bg-transparent"
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onMouseDown={(e) => {
          draggingRef.current = true;
          const rect = e.currentTarget.getBoundingClientRect();
          seekTo(e.clientX, rect);
        }}
        onMouseMove={(e) => {
          if (draggingRef.current) {
            const rect = e.currentTarget.getBoundingClientRect();
            seekTo(e.clientX, rect);
          }
        }}
        onMouseUp={() => {
          draggingRef.current = false;
        }}
      >
        {visible && duration > 0 && (
          <div
            className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-purple-500 shadow"
            style={{ left: `${pct}%` }}
          />
        )}
      </div>
    </div>
  );
}


/* ==================== 彩蛋隐藏入口面板 ==================== */

interface EggPanelProps {
  /** 是否启用（复用后台"控制台彩蛋"开关） */
  enabled?: boolean;
  /** 站点名 */
  siteName?: string;
}

// 触发密钥：快速输入完整单词即弹出彩蛋面板
const EGG_SECRET = "egg";
const EGG_TIMEOUT = 1500;
const EGG_TIPS = [
  "你发现了隐藏彩蛋 🥚",
  "彩蛋属于勇于探索的你",
  "在弹幕时代，隐藏的门总值得一推",
  "今日好心情浓度 +100%",
];

/**
 * 彩蛋隐藏入口：页面任意处快速输入密钥（egg）弹出精致居中彩蛋面板。
 * - 复用后台"控制台彩蛋"开关（consoleEgg），不新增配置；
 * - Esc / 点遮罩 / 点关闭均可退出；面板为纯展示，无任何交互提交。
 * 与 DevConsole（F12 控制台 ASCII 彩蛋）互补，构成"键盘彩蛋 + 控制台彩蛋"双入口。
 */
export function EggPanel({ enabled = true, siteName = "" }: EggPanelProps) {
  const [open, setOpen] = useState(false);
  const bufferRef = useRef("");
  const name = siteName || "本站";

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      // 在输入框等可编辑元素中不触发，避免打断正常输入
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      // 静默模式：后台开启键盘彩蛋时才收字；仅吃字母/数字，其余按键清空缓冲
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const ch = e.key.toLowerCase();
      if (!/^[a-z0-9]$/.test(ch)) {
        bufferRef.current = "";
        return;
      }
      bufferRef.current = (bufferRef.current + ch).slice(-EGG_SECRET.length);
      if (bufferRef.current === EGG_SECRET) {
        bufferRef.current = "";
        setOpen(true);
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(() => { bufferRef.current = ""; }, EGG_TIMEOUT);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (timer) clearTimeout(timer);
    };
  }, [enabled]);

  if (!enabled || !open) return null;

  const tip = EGG_TIPS[Math.floor(Math.random() * EGG_TIPS.length)];

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="隐藏彩蛋">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setOpen(false)} aria-hidden />
      <div
        className="animate-notice-center relative w-72 overflow-hidden rounded-2xl border border-white/20 bg-gradient-to-br from-[#1b2440]/95 via-[#161d33]/92 to-[#101627]/95 shadow-2xl shadow-black/50 backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-[3px]"
          style={{
            background:
              "linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--accent-color, #7dd3fc) 90%, transparent) 50%, transparent 100%)",
          }}
        />
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="关闭彩蛋"
          className="absolute right-2.5 top-2.5 z-10 rounded-full p-1 text-white/50 transition hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="flex flex-col items-center gap-3 px-5 pb-5 pt-7 text-center">
          <span className="text-3xl">🥚</span>
          <h3 className="text-[15px] font-semibold text-white">恭喜触发隐藏彩蛋</h3>
          <p className="break-words text-[13px] leading-relaxed text-white/70">{tip}</p>
          {name && (
            <p className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/50">
              来自 {name} 的一点点小心思
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ==================== Effects 组合组件 ==================== */

interface EffectsProps {
  /** 点击粒子特效开关 */
  clickEffect?: boolean;
  /** 控制台彩蛋开关 */
  consoleEgg?: boolean;
  /** 动态页面标题开关 */
  dynamicTitle?: boolean;
  /** 顶部音乐进度条开关 */
  topProgressBar?: boolean;
  /** 站点昵称 */
  siteName?: string;
}

/**
 * 首页装饰效果集合：一处挂载全部开关控制的页面效果组件。
 * 保持与原先分散挂载一致的渲染顺序。全屏加载动画已独立为 LoadingScreen 组件。
 */
export default function Effects({
  clickEffect = true,
  consoleEgg = true,
  dynamicTitle = true,
  topProgressBar = true,
  siteName = "",
}: EffectsProps) {
  return (
    <>
      <ClickEffect enabled={clickEffect} />
      <DevConsole enabled={consoleEgg} siteName={siteName} />
      <EggPanel enabled={consoleEgg} siteName={siteName} />
      <DynamicTitle enabled={dynamicTitle} siteName={siteName} />
      <TopProgressBar enabled={topProgressBar} />
    </>
  );
}

// ===== 懒加载包装（合并自 DecorativeEffectsLazy.tsx） =====

import dynamic from "next/dynamic";

const LazyEffects = dynamic(() => import("./DecorativeEffects"), {
  ssr: false,
  loading: () => null,
});

/** 客户端包装器：允许在 Server Component 中引用 ssr:false 的装饰特效动态导入 */
export function DecorativeEffectsLazy(props: EffectsProps) {
  return <LazyEffects {...props} />;
}
