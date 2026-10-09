"use client";

import { useEffect, useRef, useState } from "react";
import { Megaphone, Pin, X, BellRing } from "lucide-react";
import { fetchWeatherShared } from "@/lib/weatherClient";

interface Announcement {
  id: number;
  title: string;
  content: string;
  pinned: boolean;
}

interface AnnouncementNotificationProps {
  /** 是否启用欢迎通知（后台可配置） */
  welcomeEnabled?: boolean;
  /** 站点昵称，用于替换欢迎语中的 {siteName} 占位符 */
  siteName?: string;
  /** 欢迎语列表（JSON 字符串数组） */
  welcomeMessages?: string;
  /** 当前生效欢迎语的下标 */
  welcomeIndex?: number;
}

const DISMISS_KEY = "qiyun-announcement-dismissed";

/** 解析浏览器名称（本地获取 navigator.userAgent） */
function getBrowserName(): string {
  if (typeof navigator === "undefined") return "";
  const ua = navigator.userAgent;
  if (ua.includes("MicroMessenger")) return "微信内置浏览器";
  if (ua.includes("Edg/")) return "Edge";
  if (ua.includes("QQBrowser")) return "QQ 浏览器";
  if (ua.includes("Firefox/")) return "Firefox";
  if (ua.includes("Chrome/")) return "Chrome";
  if (ua.includes("Safari/")) return "Safari";
  return "";
}

/** 获取访客 IP 归属地（复用后端 ip2region 离线库；5s 超时，失败静默返回空） */
async function fetchVisitorLocation(): Promise<string> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch("/api/visitor/location", { signal: controller.signal });
      if (!res.ok) return "";
      const data = (await res.json()) as { region?: string };
      return data.region || "";
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // 解析失败静默，不影响欢迎弹窗展示
    return "";
  }
}

/**
 * 获取访客地域：**优先复用天气接口**那次请求顺带解析出的 region。
 *
 * 天气接口在「未配置固定城市」时会按访客 IP 定位（腾讯/高德，境内精度优于本地离线库），
 * 而这次请求本来就因为时钟卡片要发，所以先问它，命中就省掉一次请求。
 *
 * 回退到本地离线库的四种情况：配置了固定城市（那时 region 是站主的城市，不能给访客看）、
 * 未配置天气 Key、被限流（429）、海外或内网 IP（定位接口给不出结果）。
 */
async function fetchVisitorRegion(): Promise<string> {
  const { data } = await fetchWeatherShared();
  if (data?.region) return data.region;
  return fetchVisitorLocation();
}

/**
 * 站点通知居中弹窗（欢迎 + 公告合并为同一容器框）：
 * - 半透明遮罩 + 居中卡片：欢迎语（若启用）与公告列表自上而下排列在同一容器内，风格统一。
 * - 待全屏 LoadingScreen 收起后再弹出，避免与加载动画重叠。
 * - 关闭方式统一为明确操作：底部主按钮「我知道了」/ 右上角 × 关闭全部；公告可逐条 × 关闭。
 *   遮罩仅做视觉分隔，点击不再关闭（避免误触打断阅读）。
 * - 公告已读记忆到 localStorage；欢迎语每次刷新展示。
 */
export default function AnnouncementNotification({
  welcomeEnabled = true,
  siteName = "",
  welcomeMessages = "[]",
  welcomeIndex = 0,
}: AnnouncementNotificationProps) {
  const [items, setItems] = useState<Announcement[]>([]);
  const [visible, setVisible] = useState(false);
  const [visitorInfo, setVisitorInfo] = useState("");

  // 解析当前生效欢迎语（纯函数，每次渲染结果一致）
  let welcomeText = "";
  if (welcomeEnabled) {
    try {
      const list = JSON.parse(welcomeMessages) as unknown;
      if (Array.isArray(list) && list.length > 0) {
        const raw = String(list[Math.min(Math.max(welcomeIndex, 0), list.length - 1)] ?? "").trim();
        welcomeText = raw ? raw.replaceAll("{siteName}", siteName || "本站") : "";
      }
    } catch {
      welcomeText = "";
    }
  }

  // 有内容时才预取 & 展示（welcomeText 上方已计算；公告加载完会更新 items→hasContent）
  const hasContent = welcomeText.length > 0 || items.length > 0;

  // 立即预取公告与访客信息（浏览器 + 地域），组件挂载即发起，
  // 而非等弹窗 visible 后再发——消除展示时的延迟等待。
  //
  // 两者刻意各自独立落地、不再放进同一个 Promise.all：公告决定弹窗是否出现（hasContent），
  // 而"来自 X · Y"只是欢迎卡上的一行文案。合在一起会让地域的等待（天气那次调用要打外网，
  // 最长 8 秒）拖住整个弹窗；拆开后地址晚到就晚补，弹窗该弹就弹。
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const ann = await fetch("/api/announcements/public", {
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      })
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => [] as Announcement[]);
      if (cancelled) return;
      let dismissed: number[] = [];
      try {
        dismissed = JSON.parse(localStorage.getItem(DISMISS_KEY) || "[]") as number[];
      } catch {
        dismissed = [];
      }
      setItems(Array.isArray(ann) ? ann.filter((a: Announcement) => !dismissed.includes(a.id)) : []);
    })();

    void (async () => {
      const region = await fetchVisitorRegion();
      if (cancelled) return;
      const parts = [getBrowserName(), region].filter(Boolean);
      setVisitorInfo(parts.length > 0 ? `来自 ${parts.join(" · ")}` : "");
    })();

    return () => {
      cancelled = true;
    };
    // 仅组件挂载时预取一次；公告/访客信息在切换 site 后会重新挂载，由组件层面保证刷新
  }, []);

  /**
   * 是否已经自动弹过一次。
   *
   * 「加载动画已移除」事件与 3 秒兜底定时器是两条**并行**的唤出路径，谁先到都算数。
   * 少了这道闸，先到的那条唤出弹窗、用户随即点「我知道了」关掉，后到的那条仍会
   * setVisible(true)，弹窗就在关闭后一两秒莫名二次弹出。
   * 自动展示只允许发生一次；用户的关闭动作一旦发生，本次挂载内不再自动唤出。
   */
  const revealedRef = useRef(false);

  // 有欢迎语或公告后，等全屏加载动画完全移除再统一弹出
  useEffect(() => {
    if (!hasContent) return;
    let cancelled = false;
    const show = () => {
      if (cancelled || revealedRef.current) return;
      revealedRef.current = true;
      // 已唤出过：另一条路径（事件 / 定时器）到点时会被上面这道闸拦下，
      // 这里只顺手摘掉监听，定时器等它自然到点即可（最多多挂 3 秒）
      window.removeEventListener("loading-screen-removed", show);
      setVisible(true);
    };
    if (!document.getElementById("loader-wrapper")) {
      show();
      return;
    }
    window.addEventListener("loading-screen-removed", show, { once: true });
    const fallback = setTimeout(show, 3000);
    return () => {
      cancelled = true;
      clearTimeout(fallback);
      window.removeEventListener("loading-screen-removed", show);
    };
  }, [hasContent]);

  if (!visible || (!welcomeText && items.length === 0)) return null;

  const hasAnn = items.length > 0;
  const title = hasAnn ? "站点公告" : "站点欢迎";
  const HeadIcon = hasAnn ? Megaphone : BellRing;

  function rememberDismiss(ids: number[]) {
    let dismissed: number[] = [];
    try {
      dismissed = JSON.parse(localStorage.getItem(DISMISS_KEY) || "[]") as number[];
    } catch {
      dismissed = [];
    }
    for (const id of ids) {
      if (!dismissed.includes(id)) dismissed.push(id);
    }
    localStorage.setItem(DISMISS_KEY, JSON.stringify(dismissed));
  }

  function closeAll() {
    rememberDismiss(items.map((a) => a.id));
    setVisible(false);
  }

  function dismissOne(id: number) {
    rememberDismiss([id]);
    const next = items.filter((a) => a.id !== id);
    setItems(next);
    if (next.length === 0 && !welcomeText) setVisible(false);
  }

  return (
    <div className="notice-scrim" role="dialog" aria-modal="false" aria-label={title}>
      {/* 遮罩：仅视觉分隔，点击不关闭（关闭需明确操作「我知道了」/ ×） */}
      <div className="notice-backdrop" aria-hidden />
      {/* 外观全部交给 globals.css 的 .notice-* 组件类：玻璃三要素（--card-alpha /
          --glass-blur / --accent-color）与圆角投影走站内令牌，改后台配色弹窗自动跟随 */}
      <div className="notice-card animate-notice-center">
        {/* 顶部强调色发丝线 */}
        <span className="notice-hairline" aria-hidden />

        {/* 头部 */}
        <header className="notice-head">
          <span className="notice-head-icon">
            <HeadIcon className="h-[18px] w-[18px]" />
          </span>
          <h2 className="notice-title">{title}</h2>
          <button type="button" onClick={closeAll} aria-label="关闭全部通知" className="notice-close">
            <X className="h-3.5 w-3.5" />
          </button>
        </header>

        {/* 内容：欢迎语固定展示 + 公告列表独立滚动（内容多时不遮挡欢迎语与底部按钮） */}
        <div className="notice-body">
          {welcomeText && (
            <div className="notice-welcome">
              <p className="notice-welcome-text">{welcomeText}</p>
              {visitorInfo && <p className="notice-visitor">{visitorInfo}</p>}
            </div>
          )}

          {items.length > 0 && (
            <div className="notice-list">
              {items.map((a) => (
                <div key={a.id} className="notice-item">
                  <div className="notice-item-head">
                    <span className="notice-item-title">{a.title}</span>
                    {a.pinned && <Pin className="notice-pin h-3 w-3" />}
                    <button
                      type="button"
                      onClick={() => dismissOne(a.id)}
                      aria-label={`关闭公告：${a.title}`}
                      className="notice-item-close"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <p className="notice-item-text">{a.content}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 底部主操作：我知道了 */}
        <footer className="notice-foot">
          <button type="button" onClick={closeAll} className="notice-primary">
            我知道了
          </button>
        </footer>
      </div>
    </div>
  );
}