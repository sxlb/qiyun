"use client";

/**
 * 阿里云矢量图标库（iconfont.cn）Symbol 模式接入模块
 *
 * 使用方式：
 * 1. 在 iconfont.cn 创建项目 → 添加图标 → 「Symbol」模式 → 复制生成的 JS 地址
 *    （形如 https://at.alicdn.com/t/c/font_xxxx_xxxx.js），填入后台「站点信息 → 图标库地址」
 * 2. 主页通过 <IconfontScript url="..." /> 预加载；后台通过 loadIconfont() 按需加载
 * 3. 加载完成后脚本会向 <body> 注入 <svg><symbol id="icon-xxx">...</symbol></svg>，
 *    本模块扫描注册 symbol 名，广播 iconfont-loaded 事件
 * 4. 社交链接 / 网站链接的 icon 字段填入 symbol 名（如 icon-github），
 *    渲染时优先使用 iconfont 图标，未匹配则回退 lucide 图标
 */

import { useEffect, useState } from "react";

declare global {
  interface Window {
    /** 已注册的 iconfont symbol 名数组（全局缓存，幂等） */
    __iconfontSymbols?: string[];
  }
}

/** symbol 注册/更新后广播的事件名 */
export const ICONFONT_LOADED_EVENT = "iconfont-loaded";

/** 扫描页面中已注入的 <symbol id> 并注册到 window.__iconfontSymbols */
function registerSymbols(): void {
  if (typeof document === "undefined") return;
  const ids: string[] = [];
  document.querySelectorAll("svg symbol[id]").forEach((s) => {
    const id = s.getAttribute("id");
    if (id) ids.push(id);
  });
  if (!ids.length) return;
  window.__iconfontSymbols = Array.from(new Set(ids));
  window.dispatchEvent(new Event(ICONFONT_LOADED_EVENT));
}

/** 当前已加载的脚本地址（幂等标记，避免重复注入同一脚本） */
let loadedScriptUrl = "";

/**
 * 幂等加载 iconfont symbol 脚本，加载后扫描并注册 symbol。
 * 部分旧版脚本会等待 DOM 就绪才注入 symbol，因此采用轮询兜底（约 2.4s）。
 */
export function loadIconfont(url: string): void {
  if (!url) return;
  // 协议相对路径（//at.alicdn.com/...）自动补全为 https://
  // 避免在 http 环境下用 http 请求失败（阿里 iconfont 仅支持 https）
  let finalUrl = url.trim();
  if (finalUrl.startsWith("//")) {
    finalUrl = "https:" + finalUrl;
  }
  // 已加载同地址：幂等返回；地址已变更：移除旧脚本后重新加载（后台修改 iconfontUrl 后无需刷新页面）
  const existing = document.querySelector<HTMLScriptElement>(`script[data-iconfont="1"]`);
  if (existing) {
    if (existing.getAttribute("src") === finalUrl) return;
    existing.remove();
    loadedScriptUrl = "";
  }
  if (loadedScriptUrl === finalUrl) return;
  loadedScriptUrl = finalUrl;

  const script = document.createElement("script");
  script.src = finalUrl;
  script.async = true;
  script.dataset.iconfont = "1";
  script.onload = () => {
    let attempts = 0;
    const scan = () => {
      attempts++;
      registerSymbols();
      // 脚本可能延迟注入 symbol：最多轮询 12 次 × 200ms
      if (!window.__iconfontSymbols?.length && attempts < 12) {
        setTimeout(scan, 200);
      }
    };
    scan();
    // window load 后再补扫一次（覆盖脚本等待 DOMContentLoaded 的场景）
    window.addEventListener("load", scan, { once: true });
  };
  script.onerror = () => {
    loadedScriptUrl = ""; // 加载失败允许下次重试
  };
  document.head.appendChild(script);
}

/** 订阅 iconfont symbol 列表（加载完成 / 更新时重渲染） */
export function useIconfontSymbols(): string[] {
  const [symbols, setSymbols] = useState<string[]>([]);
  useEffect(() => {
    const update = () => setSymbols(window.__iconfontSymbols ?? []);
    update();
    window.addEventListener(ICONFONT_LOADED_EVENT, update);
    // 挂载后补扫一次：脚本可能先于本组件完成加载，但事件已广播过
    const timer = setTimeout(update, 400);
    return () => {
      window.removeEventListener(ICONFONT_LOADED_EVENT, update);
      clearTimeout(timer);
    };
  }, []);
  return symbols;
}

/** 主页挂载用：注入 iconfont 脚本（空地址不加载） */
export function IconfontScript({ url }: { url: string }) {
  useEffect(() => {
    if (url) loadIconfont(url);
  }, [url]);
  return null;
}
