"use client";

import { useEffect } from "react";

/**
 * 客户端 DOM 副作用组件集合（均返回 null，不产生可见 UI）。
 * 合并自原 CustomFont.tsx + FaviconUpdater.tsx。
 */

/** 自定义字体应用：范围=全站时注入 body font-family */
export function CustomFont({ enabled, family, scope }: { enabled: boolean; family: string; scope: string }) {
  useEffect(() => {
    const clean = family.trim();
    if (!enabled || !clean || scope !== "all") return;
    document.body.style.fontFamily = `"${clean}", var(--font-noto-sc), var(--font-inter), sans-serif`;
  }, [enabled, family, scope]);

  return null;
}

/** 后台配置的网站图标（favicon）动态注入浏览器标签页 */
export function FaviconUpdater({ icon }: { icon?: string }) {
  useEffect(() => {
    if (!icon) return;

    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      link.type = "image/x-icon";
      document.head.appendChild(link);
    }
    link.href = icon;

    let apple = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
    if (!apple) {
      apple = document.createElement("link");
      apple.rel = "apple-touch-icon";
      document.head.appendChild(apple);
    }
    apple.href = icon;
  }, [icon]);

  return null;
}
