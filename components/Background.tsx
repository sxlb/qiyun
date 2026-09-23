"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "./ThemeProvider";

interface Props {
  /** 自定义壁纸地址（非空时优先于 coverType 使用，兼容旧配置） */
  bgApi?: string;
  /** 壁纸种类：bing 必应 / landscape 随机风景 / anime 随机动漫 / custom 自定义 */
  coverType?: string;
  /** 定时切换间隔：0 关闭 / 1 15秒 / 2 30秒 / 3 45秒 */
  autoSwitchInterval?: number;
  /** 背景遮罩暗化强度 0-80（%）：壁纸过亮时提升前景文字可读性 */
  bgOverlay?: number;
  /** 壁纸服务端缓存刷新间隔（分钟）：0=不刷新 / 3 / 10 / 30 */
  wallpaperRefresh?: number;
  /** SSR 阶段已解析的壁纸直链：首次加载直接使用，省去客户端 /api/wallpaper 往返 */
  initialUrl?: string;
}

interface BingData {
  url: string;
  copyright?: string;
  title?: string;
}

const SWITCH_INTERVALS = [0, 15_000, 30_000, 45_000];

// 随机风景 / 动漫壁纸（图片直链，附带时间戳避免浏览器缓存同一张）
// 注：原 vvhan 壁纸源（api.vvhan.com/api/wallpaper/*）已失效（ERR_CONNECTION_CLOSED），
// 已替换为免费可用的 MWM 图床随机壁纸 API（t.mwm.moe：fj=风景 / mp=动漫）
const MWM_VIEWS_URL = () => `https://t.mwm.moe/fj?t=${Date.now()}`;
const MWM_ACG_URL = () => `https://t.mwm.moe/mp?t=${Date.now()}`;

/** 拉取必应每日壁纸直链（各壁纸源失败时的降级目标） */
async function resolveBing(): Promise<string> {
  const res = await fetch("/api/bing", { cache: "no-store" });
  if (res.ok) {
    const data: BingData = await res.json();
    if (data.url) return data.url;
  }
  return "";
}

/**
 * 从背景图片提取主色调（明暗），用于"跟随背景"主题模式。
 *
 * 算法说明：
 * 1. 将图片绘制到 canvas 后读取像素数据
 * 2. 先缩放到最大 64px 的采样图再读取：像素量恒定（64×64×4 ≈ 16KB），
 *    避免大壁纸全尺寸 getImageData 造成的内存与耗时开销
 * 3. 隔 4 像素采样一次（每个像素 4 通道 = 步长 16），兼顾速度与准确度
 * 4. 使用 ITU-R BT.601 标准亮度公式：brightness = (R*299 + G*587 + B*114) / 1000
 *    其中绿色权重最高（587），红色次之（299），蓝色最低（114），符合人眼感知特性
 * 5. 以 128 为阈值：亮度 < 128 记为暗像素，否则记为亮像素
 * 6. 亮像素多 → "light"，暗像素多 → "dark"
 */
function getColorFromImage(img: HTMLImageElement): Promise<"light" | "dark"> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      reject(new Error("无法获取 canvas 的 2d context"));
      return;
    }
    // 缩小到 64px 采样图：drawImage 缩放由浏览器处理，读取的像素量恒定
    const MAX_SAMPLE_SIZE = 64;
    canvas.width = Math.min(img.naturalWidth, MAX_SAMPLE_SIZE);
    canvas.height = Math.min(img.naturalHeight, MAX_SAMPLE_SIZE);
    try {
      context.drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let light = 0;
      let dark = 0;
      // 每个像素占 4 字节（RGBA），步长 16 = 每 4 个像素取 1 个，在速度和精度之间取得平衡
      for (let i = 0; i < data.length; i += 16) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        // ITU-R BT.601 亮度公式：绿 > 红 > 蓝，模拟人眼对绿色的敏感度最高
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        if (brightness < 128) {
          dark++;
        } else {
          light++;
        }
      }
      resolve(light > dark ? "light" : "dark");
    } catch (e) {
      reject(e instanceof Error ? e : new Error("无法处理图片以获取颜色"));
    }
  });
}

/**
 * 壁纸背景层
 * - 多源：必应每日壁纸 / 随机风景 / 随机动漫 / 自定义地址
 * - 定时切换：按 autoSwitchInterval 自动更换
 * - 壁纸加载后提取主色并上报，供"跟随背景"主题模式使用
 */
export default function Background({
  bgApi = "",
  coverType = "bing",
  autoSwitchInterval = 0,
  bgOverlay = 0,
  wallpaperRefresh = 0,
  initialUrl = "",
}: Props) {
  const { setBgTheme } = useTheme();
  const [url, setUrl] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  // 标记 SSR 直链是否已被首次加载使用（后续定时切换仍走 /api/wallpaper 取随机壁纸）
  const usedInitialRef = useRef(false);

  /** 背景就绪（成功或彻底失败）后广播，供全屏加载动画同步收起 */
  const announceReady = () => {
    // 【Medium 修复】使用 CustomEvent 而非 Event，detail 携带壁纸 URL，方便消费者扩展
    (window as unknown as { __bgReady?: boolean }).__bgReady = true;
    window.dispatchEvent(new CustomEvent("background-ready", { detail: { url, loaded } }));
  };

  // 解析当前壁纸地址
  const resolveUrl = useCallback(async (): Promise<string> => {
    const custom = bgApi.trim();
    // 自定义地址优先级最高（兼容旧配置：填了 bgApi 就走自定义），用户直链直接使用，不走缓存
    if (custom) return custom;

    // 优先走服务端壁纸缓存：下载到服务器本地，源 API 失效也能正常展示
    try {
      const qs = new URLSearchParams({
        coverType,
        bgApi: "",
        refresh: String(wallpaperRefresh),
        t: String(Date.now()),
      });
      const res = await fetch(`/api/wallpaper?${qs}`, { cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as { url?: string };
        if (json.url) return json.url;
      }
    } catch {
      /* 缓存服务异常时走直连兜底 */
    }

    // 兜底：直连壁纸源
    switch (coverType) {
      case "landscape":
        return MWM_VIEWS_URL();
      case "anime":
        return MWM_ACG_URL();
      case "custom":
        return "";
      default:
        return resolveBing();
    }
  }, [bgApi, coverType, wallpaperRefresh]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    // 非必应源失败时降级为必应壁纸（每轮最多一次，避免定时重试反复刷屏）
    let fallbackUsed = false;

    // 加载并展示壁纸，失败时降级必应
    function applyImage(bgUrl: string) {
      const img = new Image();
      img.onload = () => {
        if (cancelled) return;
        fallbackUsed = false; // 壁纸源恢复成功后重置降级标记
        setUrl(bgUrl);
        // 给浏览器一帧时间应用初始样式后再触发淡入
        requestAnimationFrame(() => setLoaded(true));
        getColorFromImage(img)
          .then(setBgTheme)
          .catch(() => {
            /* 主色提取失败不影响壁纸展示 */
          });
        // 首帧背景就绪后广播，全屏加载动画可同步收起
        announceReady();
      };
      img.onerror = async () => {
        if (cancelled) return;
        // 必应源不再降级；其余源失败时降级为必应壁纸
        if (coverType !== "bing" && !fallbackUsed) {
          fallbackUsed = true;
          if (process.env.NODE_ENV !== "production") {
            console.warn(`壁纸源 ${bgUrl} 加载失败，降级为必应壁纸`);
          }
          try {
            const bingUrl = await resolveBing();
            if (cancelled || !bingUrl) {
              announceReady(); // 无可用兜底：结束尝试，避免加载动画一直等待
              return;
            }
            const bingImg = new Image();
            bingImg.onload = () => {
              if (cancelled) return;
              setUrl(bingUrl);
              requestAnimationFrame(() => setLoaded(true));
              getColorFromImage(bingImg)
                .then(setBgTheme)
                .catch(() => {
                  /* 主色提取失败不影响壁纸展示 */
                });
              announceReady();
            };
            bingImg.onerror = () => {
              if (process.env.NODE_ENV !== "production") {
                console.warn("必应壁纸加载失败:", bingUrl);
              }
              announceReady();
            };
            bingImg.src = bingUrl;
          } catch {
            announceReady(); // 降级异常：结束尝试
          }
        } else {
          announceReady(); // 必应源失败（或已降级过）：直接结束
        }
      };
      img.src = bgUrl;
    }

    async function load() {
      try {
        // 首次加载：直接使用 SSR 阶段解析好的直链（浏览器已通过 preload 开始下载）
        let bgUrl = "";
        if (!usedInitialRef.current && initialUrl) {
          usedInitialRef.current = true;
          bgUrl = initialUrl;
        } else {
          bgUrl = await resolveUrl();
        }
        if (cancelled || !bgUrl) {
          // 无可用壁纸（如 custom 类型未配置地址）：结束尝试并广播就绪，
          // 否则全屏加载动画只能等 5s 兜底超时
          if (!cancelled) announceReady();
          return;
        }
        // 预加载确保淡入，同时提取主色
        applyImage(bgUrl);
      } catch (e) {
        if (process.env.NODE_ENV === "development") console.warn("壁纸加载异常:", e);
        announceReady(); // 解析异常：结束尝试
      }
    }

    load();

    // 定时切换
    const interval = SWITCH_INTERVALS[autoSwitchInterval] ?? 0;
    if (interval > 0) {
      timer = window.setInterval(load, interval);
    }

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [resolveUrl, coverType, autoSwitchInterval, setBgTheme, initialUrl]);

  return (
    /* 背景层：加载期间显示半透明深色底色作为过渡，避免白屏；图片加载完成后淡入 */
    <div className="fixed inset-0 -z-10 overflow-hidden bg-[#0a0a0a]">
      {url ? (
        <div
          className="absolute inset-0 scale-110 bg-cover bg-center transition-all duration-1000"
          style={{
            backgroundImage: `url("${url}")`,
            opacity: loaded ? 1 : 0,
            // 无模糊无暗化（纯透明），用 opacity 控制淡入
            transform: loaded ? "scale(1)" : "scale(1.05)",
          }}
        />
      ) : (
        /* 占位底纹：CSS 噪点纹理，避免纯黑单调 */
        <div className="absolute inset-0 opacity-30" style={{
          backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\' opacity=\'0.4\'/%3E%3C/svg%3E")',
        }} />
      )}
      {/* 可配置暗化遮罩：壁纸过亮时按后台强度（bgOverlay%）叠加黑层提升可读性 */}
      {bgOverlay > 0 && (
        <div
          className="absolute inset-0"
          style={{ backgroundColor: `rgba(0, 0, 0, ${Math.min(80, Math.max(0, bgOverlay)) / 100})` }}
        />
      )}
    </div>
  );
}
