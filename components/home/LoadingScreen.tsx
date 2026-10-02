"use client";

import { useEffect, useState } from "react";

interface LoadingScreenProps {
  /** 是否启用加载动画（后台可配置） */
  enabled?: boolean;
  /** 站点昵称，显示在加载动画中央 */
  siteName?: string;
}

/**
 * 全屏加载动画
 * - 三环旋转动画 + 站点名 + Loading 文字
 * - 收起时机：最短展示 800ms 后，若壁纸已就绪（或壁纸源失败）即收起。
 *   期间壁纸已在后台通过 SSR preload + new Image() 预加载，保证动画结束壁纸必然已在底层，
 *   不再因宽松超时"提前收口"导致动画结束后出现黑屏待壁纸。
 * - 安全兜底：最长 7s 强制收起，防止背景源异常导致加载动画卡死
 */
export function LoadingScreen({ enabled = true, siteName = "" }: LoadingScreenProps) {
  const [loaded, setLoaded] = useState(false);
  const [removed, setRemoved] = useState(false);

  useEffect(() => {
    if (!enabled || removed) return;

    let mounted = true;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;

    const hide = () => {
      if (!mounted || hideTimer) return;
      // 先加 loaded 状态触发分屏收起动画
      setLoaded(true);
      // 等动画全部完成再移除节点：分屏收起 0.3s 延迟 + 0.5s，整体上移 1s 延迟 + 0.3s，共 1.3s
      hideTimer = setTimeout(() => {
        if (mounted) setRemoved(true);
        // 广播"加载动画已完全移除"，供欢迎通知等组件在动画结束后再展示
        window.dispatchEvent(new Event("loading-screen-removed"));
      }, 1400);
    };

    // 壁纸就绪后立即收起（Background 成功或失败都会广播 background-ready）
    const onBgReady = () => {
      if (mounted && !hideTimer) hide();
    };

    // 最短展示 800ms（避免闪屏），期间壁纸已通过 SSR preload 后台下载、
    // Background 组件 new Image() 预加载——动画结束时壁纸必然已渲染在底层，不会出现"壁纸还没出来"。
    const minTimer = setTimeout(() => {
      if (mounted && !hideTimer) {
        if ((window as unknown as { __bgReady?: boolean }).__bgReady) {
          hide();
        } else {
          window.addEventListener("background-ready", onBgReady, { once: true });
        }
      }
    }, 800);

    // 安全兜底：仅供背景源/事件异常时兜底，正常判定完全由 background-ready 决定，
    // 从而保证"动画结束前壁纸已就绪"。不再提供 2.8s 的宽松提前收起（那是黑屏的根源）。
    const safety = setTimeout(hide, 7000);

    return () => {
      mounted = false;
      if (minTimer) clearTimeout(minTimer);
      if (safety) clearTimeout(safety);
      if (hideTimer) clearTimeout(hideTimer);
      window.removeEventListener("background-ready", onBgReady);
    };
  }, [enabled, removed]);

  if (!enabled || removed) return null;

  return (
    <div
      id="loader-wrapper"
      className={`fixed inset-0 z-[999] overflow-hidden bg-gradient-to-br from-[#1a1a2e] via-[#16213e] to-[#1a1a2e] ${
        loaded ? "loader-loaded" : ""
      }`}
      aria-hidden
    >
      {/* 中心加载内容 */}
      <div className="loader">
        <div className="loader-circle" />
        <div className="loader-text">
          <span className="loader-name">{siteName || "个人主页"}</span>
          <span className="loader-tip">Loading...</span>
        </div>
      </div>
      {/* 左右分屏遮罩（使用与背景一致的渐变色） */}
      <div className="loader-section loader-section-left" style={{ background: "linear-gradient(90deg, #1a1a2e 0%, #16213e 100%)" }} />
      <div className="loader-section loader-section-right" style={{ background: "linear-gradient(270deg, #1a1a2e 0%, #16213e 100%)" }} />
    </div>
  );
}
