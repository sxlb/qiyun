"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 最短展示时长：壁纸命中缓存时若立即收起会有"闪一下"的观感，同时给分屏动画留出起势时间。
 * 期间壁纸已在后台通过 SSR preload + new Image() 预加载，动画结束时壁纸必然已渲染在底层。
 */
const MIN_SHOW_MS = 800;

/**
 * 安全兜底：背景源或事件异常时强制收起。
 *
 * 取 3s 而不是更长的值：早期版本这里是 7s，但壁纸链路（服务端首次下载 + 浏览器再下一遍
 * 全尺寸原图）在冷缓存下很容易超过它，用户实际感知就是"进站要等 7 秒"。
 * 现在壁纸只影响"更好看"，不该再决定"能不能进页面"；背景底图由 Background 首帧铺好，
 * 因此 3s 之后无论壁纸是否到位都放行。
 *
 * 必须**早于** globals.css 里 #loader-wrapper 的纯 CSS 兜底（6s），否则 CSS 会先一步锁死
 * visibility，把分屏收起动画截断成"闪一下消失"。
 */
const SAFETY_MS = 3000;

/**
 * 收起动画兜底时长：分屏收起（延迟 0.3s + 0.5s）与整体上移（延迟 1s + 0.3s）的合计约 1.3s。
 * 正常情况下由包裹层的 transitionend 事件驱动移除节点，本计时器只兜住
 * 「过渡被 prefers-reduced-motion 或样式覆盖吞掉、事件永不到达」的边角情况。
 */
const EXIT_FALLBACK_MS = 1400;

interface LoadingScreenProps {
  /** 是否启用加载动画（后台可配置） */
  enabled?: boolean;
  /** 站点昵称，显示在加载动画中央 */
  siteName?: string;
}

/**
 * 全屏加载动画（事件驱动）
 *
 * 收起条件（两个信号都到齐才收，先到者等待后到者）：
 *   1. 已过最短展示时长 MIN_SHOW_MS；
 *   2. 壁纸已就绪 —— Background 组件在「加载成功」与「彻底失败」两种结局下都会广播
 *      background-ready，因此不会出现"壁纸加载失败导致动画卡死"。
 *
 * 移除节点（而不是靠估算动画时长写死一个 setTimeout）：
 *   监听包裹层自身 transform 过渡的 transitionend，动画一结束立刻移除；
 *   另留 EXIT_FALLBACK_MS 计时器兜底。这样即使将来调整 CSS 动画时长，
 *   组件也不需要跟着改魔法数字。
 *
 * 所有监听器都挂在本 effect 的 AbortController 上，卸载时一次 abort 全部回收，
 * 不会残留"卸载后仍触发 setState"的监听。
 */
export function LoadingScreen({ enabled = true, siteName = "" }: LoadingScreenProps) {
  const [loaded, setLoaded] = useState(false);
  const [removed, setRemoved] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!enabled || removed) return;

    const controller = new AbortController();
    const { signal } = controller;
    const wrapper = wrapperRef.current;

    // 状态机：minElapsed（最短展示已过）→ startedExit（收起动画已启动）→ finished（节点已移除）
    let minElapsed = false;
    let startedExit = false;
    let finished = false;
    let exitTimer: ReturnType<typeof setTimeout> | undefined;

    /**
     * 移除遮罩节点，并广播"加载动画已完全移除"供欢迎通知等组件接续展示。
     *
     * finished 守卫是必要的：transitionend 与 EXIT_FALLBACK_MS 计时器可能几乎同时到达
     * （事件先到触发 setRemoved，但 React 尚未提交、effect 清理还没执行，计时器就已到期），
     * 缺了它会重复广播 —— 而"移除完成"这个信号在语义上必须恰好一次。
     */
    const finish = () => {
      if (finished || signal.aborted) return;
      finished = true;
      setRemoved(true);
      window.dispatchEvent(new Event("loading-screen-removed"));
    };

    /** 启动收起动画（幂等）：加 loaded 类触发分屏收起 + 整体上移 */
    const beginExit = () => {
      if (startedExit || signal.aborted) return;
      startedExit = true;
      setLoaded(true);
      exitTimer = setTimeout(finish, EXIT_FALLBACK_MS);
    };

    /**
     * 唯一的收起入口：必须同时满足「最短展示已过」与「壁纸就绪」。
     * 两个信号谁后到，谁负责触发（先到的只记录状态），因此不存在时序倒置导致永不收起。
     */
    const onBackgroundReady = () => {
      if (minElapsed) beginExit();
    };

    window.addEventListener("background-ready", onBackgroundReady, { signal });

    // 只认包裹层自身"整体上移"的那次过渡结束：分屏子元素的 transform 同样会冒泡，
    // 不校验 target / propertyName 就会在动画刚起势时提前移除节点。
    const onTransitionEnd = (event: TransitionEvent) => {
      if (event.target !== wrapper) return;
      if (event.propertyName !== "transform") return;
      finish();
    };
    wrapper?.addEventListener("transitionend", onTransitionEnd, { signal });

    // 信号 1：最短展示时长
    const minTimer = setTimeout(() => {
      minElapsed = true;
      // 壁纸可能在本组件挂载前就已就绪（SSR preload 命中缓存时不会再收到事件），此处直接复查
      if ((window as unknown as { __bgReady?: boolean }).__bgReady) beginExit();
    }, MIN_SHOW_MS);

    // 信号 2：安全兜底
    const safetyTimer = setTimeout(beginExit, SAFETY_MS);

    return () => {
      controller.abort(); // 一次性注销 background-ready / transitionend 监听
      clearTimeout(minTimer);
      clearTimeout(safetyTimer);
      if (exitTimer) clearTimeout(exitTimer);
    };
  }, [enabled, removed]);

  if (!enabled || removed) return null;

  return (
    <div
      id="loader-wrapper"
      ref={wrapperRef}
      // 配色由 globals.css 的 --loader-* 令牌给出（浅/深主题各一套），此处不再写死颜色
      className={`fixed inset-0 z-[999] overflow-hidden ${loaded ? "loader-loaded" : ""}`}
      aria-hidden
    >
      {/* 中心加载内容 */}
      <div className="loader">
        {/* 极光光晕：强调色低频呼吸，为单道弧补氛围 */}
        <div className="loader-aurora" />
        {/* 主视觉：强调色渐变弧（配色见 globals.css 的 --loader-accent） */}
        <div className="loader-arc" />
        <div className="loader-text">
          <span className="loader-name">{siteName || "个人主页"}</span>
          <span className="loader-tip">Loading...</span>
        </div>
        {/* 细进度线：无确定进度，用往返光带表达"进行中" */}
        <div className="loader-bar" />
      </div>
      {/* 左右分屏遮罩（配色同样取自主题令牌） */}
      <div className="loader-section loader-section-left" />
      <div className="loader-section loader-section-right" />
    </div>
  );
}
