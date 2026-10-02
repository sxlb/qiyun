"use client";

import { useEffect, useState } from "react";
import { Megaphone, Pin, X, BellRing } from "lucide-react";

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

  // 立即并行预取访客信息（浏览器 + IP 归属地）与公告，组件挂载即发起，
  // 而非等弹窗 visible 后再发——消除展示时的延迟等待
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [browser, location, ann] = await Promise.all([
        Promise.resolve(getBrowserName()),
        fetchVisitorLocation(),
        // 单独并行拉公告（与访客信息互不阻塞）
        fetch("/api/announcements/public", { cache: "no-store", signal: AbortSignal.timeout(8000) })
          .then((r) => (r.ok ? r.json() : []))
          .catch(() => [] as Announcement[]),
      ]);
      if (cancelled) return;
      let dismissed: number[] = [];
      try {
        dismissed = JSON.parse(localStorage.getItem(DISMISS_KEY) || "[]") as number[];
      } catch {
        dismissed = [];
      }
      setItems(Array.isArray(ann) ? ann.filter((a: Announcement) => !dismissed.includes(a.id)) : []);
      const parts = [browser, location].filter(Boolean);
      setVisitorInfo(parts.length > 0 ? `来自 ${parts.join(" · ")}` : "");
    })();
    return () => {
      cancelled = true;
    };
    // 仅组件挂载时预取一次；公告/访客信息在切换 site 后会重新挂载，由组件层面保证刷新
  }, []);

  // 有欢迎语或公告后，等全屏加载动画完全移除再统一弹出
  useEffect(() => {
    if (!hasContent) return;
    let cancelled = false;
    const show = () => {
      if (!cancelled) setVisible(true);
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
    <div
      className="fixed inset-0 z-[85] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="false"
      aria-label={title}
    >
      {/* 遮罩：仅视觉分隔，点击不关闭（关闭需明确操作「我知道了」/ ×） */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" aria-hidden />
      <div
        className="animate-notice-center relative flex max-h-[70vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-white/20 bg-gradient-to-br from-[#1b2440]/95 via-[#161d33]/92 to-[#101627]/95 shadow-2xl shadow-black/50 backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部强调色渐变条 */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-[3px]"
          style={{
            background:
              "linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--accent-color, #7dd3fc) 90%, transparent) 50%, transparent 100%)",
          }}
        />
        {/* 头部 */}
        <div className="shrink-0 border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-3">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
              style={{
                backgroundColor: "color-mix(in srgb, var(--accent-color, #7dd3fc) 22%, transparent)",
                color: "var(--accent-color, #7dd3fc)",
              }}
            >
              <HeadIcon className="h-5 w-5" />
            </span>
            <h2 className="min-w-0 flex-1 text-[15px] font-semibold text-white">{title}</h2>
            <button
              type="button"
              onClick={closeAll}
              aria-label="关闭全部通知"
              className="shrink-0 rounded-lg border border-white/10 bg-white/10 p-1.5 text-white/60 transition-all hover:bg-white/20 hover:text-white active:scale-95"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* 内容：欢迎卡固定展示 + 公告列表独立滚动（内容多时不遮挡欢迎卡与底部按钮） */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {welcomeText && (
            <div
              className={`shrink-0 px-5 pt-4 ${
                items.length > 0 ? "border-b border-white/10 pb-3" : ""
              }`}
            >
              <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/5 p-3.5">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                  style={{
                    backgroundColor:
                      "color-mix(in srgb, var(--accent-color, #7dd3fc) 18%, transparent)",
                    color: "var(--accent-color, #7dd3fc)",
                  }}
                >
                  <BellRing className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="break-words text-[14px] leading-relaxed text-white/90">
                    {welcomeText}
                  </p>
                  {visitorInfo && <p className="mt-1 text-[12px] text-white/50">{visitorInfo}</p>}
                </div>
              </div>
            </div>
          )}

          {items.length > 0 && (
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {items.map((a) => (
            <div key={a.id} className="rounded-xl border border-white/10 bg-white/5 p-3.5">
              <div className="flex items-center gap-1.5 pr-1">
                <span className="text-[13px] font-semibold text-white/90">{a.title}</span>
                {a.pinned && <Pin className="h-3 w-3 shrink-0 text-amber-300/90" />}
                <button
                  type="button"
                  onClick={() => dismissOne(a.id)}
                  aria-label={`关闭公告：${a.title}`}
                  className="ml-auto rounded p-0.5 text-white/40 transition hover:bg-white/10 hover:text-white/80"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-white/70">
                {a.content}
              </p>
            </div>
              ))}
            </div>
          )}
        </div>

        {/* 底部主操作：我知道了 */}
        <div className="shrink-0 border-t border-white/10 px-5 py-4">
          <button
            type="button"
            onClick={closeAll}
            className="w-full rounded-xl py-2.5 text-sm font-semibold text-[#0b1220] transition-all duration-200 hover:brightness-105 active:scale-[0.99]"
            style={{
              background:
                "linear-gradient(135deg, color-mix(in srgb, var(--accent-color, #7dd3fc) 80%, white) 0%, var(--accent-color, #7dd3fc) 100%)",
              boxShadow:
                "0 8px 20px -8px color-mix(in srgb, var(--accent-color, #7dd3fc) 75%, transparent)",
            }}
          >
            我知道了
          </button>
        </div>
      </div>
    </div>
  );
}