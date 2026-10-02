"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";

export type ThemeMode = "system" | "time" | "bg" | "light" | "dark";

interface ThemeContextValue {
  /** 背景主色（由 Background 组件在壁纸加载后上报） */
  bgTheme: "light" | "dark" | null;
  setBgTheme: (t: "light" | "dark") => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  bgTheme: null,
  setBgTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

/**
 * 主题提供者：
 * - system：跟随系统 prefers-color-scheme
 * - time：6:00-18:00 浅色，其余深色（每小时自动重算）
 * - bg：跟随背景主色（由 Background 上报）
 * - light / dark：固定模式
 * 通过给 <html> 添加/移除 .dark 类切换主题。
 */
export default function ThemeProvider({
  theme,
  accentColor = "",
  glassOpacity = 28,
  glassBlur = 16,
  children,
}: {
  theme: ThemeMode;
  /** 主题强调色（hex，空则用默认天蓝） */
  accentColor?: string;
  /** 玻璃卡片不透明度 0-80（黑底 alpha 百分比） */
  glassOpacity?: number;
  /** 玻璃卡片模糊强度 0-40（px） */
  glassBlur?: number;
  children: React.ReactNode;
}) {
  const [bgTheme, setBgTheme] = useState<"light" | "dark" | null>(null);

  // 高级视觉配置：强调色 + 玻璃卡片质感。
  // 服务端渲染时内联到包装元素上（子组件全部在其内部，变量可继承），
  // 避免等客户端 useEffect 挂载后才设置导致首屏颜色闪烁（FOUC）。
  const accent = accentColor && /^#[0-9a-fA-F]{3,8}$/.test(accentColor) ? accentColor : "#7dd3fc";
  const glassAlpha = String(Math.max(0, Math.min(80, glassOpacity)) / 100);
  const glassBlurPx = `${Math.max(0, Math.min(40, glassBlur))}px`;

  const applyTheme = useCallback(
    (mode: ThemeMode, bg: "light" | "dark" | null) => {
      const html = document.documentElement;
      let dark = false;
      switch (mode) {
        case "dark":
          dark = true;
          break;
        case "light":
          dark = false;
          break;
        case "time": {
          const hour = new Date().getHours();
          dark = hour < 6 || hour >= 18;
          break;
        }
        case "bg":
          dark = bg === "dark";
          break;
        default:
          dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      }
      // 主题切换时短暂开启颜色过渡
      html.classList.add("theme-transition");
      html.classList.toggle("dark", dark);
      window.setTimeout(() => html.classList.remove("theme-transition"), 350);
    },
    []
  );

  useEffect(() => {
    applyTheme(theme, bgTheme);
  }, [theme, bgTheme, applyTheme]);

  // time 模式：定时重算
  useEffect(() => {
    if (theme !== "time") return;
    const timer = window.setInterval(() => applyTheme("time", bgTheme), 60_000);
    return () => window.clearInterval(timer);
  }, [theme, bgTheme, applyTheme]);

  // system 模式：监听系统主题变化
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system", bgTheme);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme, bgTheme, applyTheme]);

  return (
    <ThemeContext.Provider value={{ bgTheme, setBgTheme }}>
      {/* 内联 CSS 变量：供全站 glass-card / 发光文字引用（服务端首帧即生效） */}
      <div
        style={
          {
            "--accent-color": accent,
            // 玻璃卡片不透明度：.card-glass 读取 --card-alpha（globals.css 中定义），
            // 此处覆盖其默认值，使后台「玻璃卡片不透明度」滑杆真正生效
            "--card-alpha": glassAlpha,
            "--glass-blur": glassBlurPx,
          } as React.CSSProperties
        }
      >
        {children}
      </div>
    </ThemeContext.Provider>
  );
}
