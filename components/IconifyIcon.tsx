"use client";

/**
 * Iconify 在线图标渲染组件。
 * 值形如 prefix:name（如 fa:github、mdi:home、tabler:brand-github），
 * 按需从 Iconify API（默认 https://api.iconify.design，可在后台「外部服务」面板更换）
 * 拉取 SVG 并内联注入，随父级文字颜色走 currentColor。
 * - color=currentColor：让图标可随主题 / hover 变色
 * - 模块级缓存（LRU 上限，防止长时间运行内存泄漏）；loadingSet 做并发去重
 * - 加载失败 / 结果非 SVG 时兜底为默认 Link 图标，避免留空白
 * - useRef 替代 useState 作为初始源：避免 SSR 返回空白占位符后 hydration
 *   检测到非空 cached SVG 产生水合不匹配（React Hydration Mismatch）
 */

import { useEffect, useRef, useState } from "react";
import { EXTERNAL_API_DEFAULTS } from "@/lib/external-api";
import { sanitizeRemoteSvg } from "@/lib/iconValue";

const ICONIFY_CACHE_MAX_SIZE = 200; // 最多缓存 200 个图标 SVG

/** LRU 模块级图标缓存（key 为 prefix:name，达到上限时驱逐最老条目） */
// 【High 修复】用 Map 替代 Record 实现 LRU，fetch 加 AbortSignal.timeout 防止挂起
const iconSvgCache = new Map<string, string>();
/** 加载中的图标集合（并发去重） */
const loadingSet = new Set<string>();

/** 兜底链接图标（本地内联，避免外链依赖） */
const fallbackSvgContent = `<path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/>`;

function buildFallback(size: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="${size}" height="${size}">${fallbackSvgContent}</svg>`;
}

export default function IconifyIcon({
  icon,
  size = 24,
  className,
  apiBase,
}: {
  icon: string;
  size?: number;
  className?: string;
  /** Iconify API 基地址（后台「外部服务」配置；留空则用内置默认） */
  apiBase?: string;
}) {
  // API 基地址：空串回退内置默认，便于上游失效 / 需走镜像时换源而无需改代码
  const base = (apiBase || "").trim() || EXTERNAL_API_DEFAULTS.iconifyApi;
  // 用 ref 记录初始化时的缓存值，避免 SSR hydration 时 setState 产生水合不匹配
  const cachedInit = useRef<string>(iconSvgCache.get(icon) ?? "");
  const [svg, setSvg] = useState(cachedInit.current);

  useEffect(() => {
    // 若缓存已有值，同步到 state（仅 hydrate 后执行一次）
    const cached = iconSvgCache.get(icon);
    if (cached) {
      setSvg(cached);
      return;
    }
    if (loadingSet.has(icon)) return;
    loadingSet.add(icon);

    // 取消令牌：icon 变化或组件卸载后，先前请求的结果不得再写入 state / 缓存，
    // 否则会出现「换了图标却显示上一个图标」，并可能把被中止后的残缺响应写进缓存。
    let cancelled = false;
    const controller = new AbortController();
    // 组合信号：换图标 / 卸载时立即中止；否则 5s 超时，防止网络挂起
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]);

    fetch(`${base}/${encodeURIComponent(icon)}.svg?color=currentColor`, { signal })
      .then(async (resp) => {
        if (cancelled) return;
        const text = resp.ok ? await resp.text() : "";
        if (cancelled) return;
        const value =
          resp.ok && text.trimStart().startsWith("<svg") ? text : buildFallback(size);
        // LRU：达到上限时驱逐最老的条目
        if (iconSvgCache.size >= ICONIFY_CACHE_MAX_SIZE) {
          const firstKey = iconSvgCache.keys().next().value;
          if (firstKey) iconSvgCache.delete(firstKey);
        }
        iconSvgCache.set(icon, value);
        setSvg(value);
      })
      .catch(() => {
        if (cancelled) return;
        const fallback = buildFallback(size);
        iconSvgCache.set(icon, fallback);
        setSvg(fallback);
      })
      .finally(() => loadingSet.delete(icon));

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [icon, size, base]);

  if (!svg)
    return (
      <span
        data-testid="iconify-icon"
        aria-hidden="true"
        style={{ width: size, height: size }}
        className={className}
      />
    );
  return (
    <span
      data-testid="iconify-icon"
      aria-hidden="true"
      className={className}
      style={{
        width: size,
        height: size,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: "currentColor",
        lineHeight: 0,
      }}
      // 远程 SVG 属不可信输入：注入前先清洗（剥离事件属性/脚本子标签/危险协议）并统一尺寸，
      // 避免图源被投毒或被误配成第三方地址时形成前台 XSS
      dangerouslySetInnerHTML={{ __html: sanitizeRemoteSvg(svg, size) }}
    />
  );
}