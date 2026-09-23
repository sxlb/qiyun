"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  /** 昵称文本（用于预热对应字形的 unicode-range 分片） */
  text: string;
  /** 当前艺术字体 CSS 工具类（如 font-art-nowar，与 globals.css 定义对应） */
  fontClass: string;
  /** 自定义字体 font-family（可选；提供时优先于 fontClass 生效） */
  fontFamily?: string;
}

/** 预热超时：字体加载超过该时长后强制显示，避免弱网下昵称长时间半透明 */
const PRELOAD_TIMEOUT = 4000;

/**
 * 昵称艺术字体平滑加载器
 *
 * 问题：next/font 默认 font-display: swap，字体分片未就绪时先以回退字体渲染，
 *      就绪后再瞬间切换 → 出现"楷体 → 艺术字体"的突兀闪烁（FOUT）。
 *
 * 方案：
 * 1. 挂载后通过隐藏探针读取当前生效 font-family，用 document.fonts.load 按昵称
 *    真实文本预热字形分片（与 LoadingScreen 展示动画并行，动画收起时字体已就绪）；
 * 2. 未就绪时昵称以低透明度显示，就绪后 0.4s 淡入——用户看到的是"渐进显现"而非
 *    "字形突变"；已缓存字体的二次访问几乎无感知。
 * 3. 超时兜底（4s）：弱网下也保证昵称完整显示。
 */
export default function LogoFontLoader({ text, fontClass, fontFamily }: Props) {
  const [ready, setReady] = useState(false);
  const probeRef = useRef<HTMLSpanElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let mounted = true;
    const probe = probeRef.current;
    if (!probe) return;

    // 从探针元素读取当前生效的 font-family：第一个即当前艺术字体（next/font 会生成带 hash 的名字）
    const family = window
      .getComputedStyle(probe)
      .fontFamily.split(",")[0]
      ?.trim()
      .replace(/^["']|["']$/g, "");
    if (!family) {
      setReady(true);
      return;
    }

    // 超时兜底：不能让昵称长时间半透明
    timeoutRef.current = setTimeout(() => {
      if (mounted) setReady(true);
    }, PRELOAD_TIMEOUT);

    // 预热当前字体：按昵称真实文本触发对应分片加载（weight 400/600 双保险）
    Promise.all([
      document.fonts.load(`400 48px ${family}`, text),
      document.fonts.load(`600 48px ${family}`, text),
    ])
      .catch(() => {
        /* 预热失败：交由超时兜底 */
      })
      .finally(() => {
        // 分片加载完毕（含无匹配字符的 resolve），立即就绪
        if (mounted) setReady(true);
      });

    return () => {
      mounted = false;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [text, fontClass]);

  return (
    <>
      {/* 隐藏探针：与昵称相同字体类，仅用于读取 font-family（脱离文档流，不影响布局） */}
      <span
        ref={probeRef}
        aria-hidden
        className={`${fontClass} absolute h-px w-px overflow-hidden`}
        style={{ visibility: "hidden", ...(fontFamily ? { fontFamily } : {}) }}
      >
        {text}
      </span>
      {/* 昵称本体：未就绪时低透明度，就绪后淡入 */}
      <span
        className={`logo-font-fade ${ready ? "logo-font-ready" : ""}`}
        style={fontFamily ? { fontFamily } : undefined}
      >
        {text}
      </span>
    </>
  );
}
