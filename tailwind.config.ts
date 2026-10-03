import type { Config } from "tailwindcss";
// 必须用静态 import：本文件会被 Next 以 ESM 加载，ESM 作用域内没有 require，
// 写成 require("tailwindcss-animate") 会在编译路由（如 /api/wallpaper）时抛
// ReferenceError: require is not defined 并直接终止 dev server。
import tailwindAnimate from "tailwindcss-animate";

const config: Config = {
  // 深浅色由 <html class="dark"> 驱动（见 lib/theme.ts 首帧脚本 + ThemeProvider 运行时），
  // 不使用默认的 "media"：默认值会让 dark: 变体只跟随系统偏好，
  // 与后台「主题设置」冲突——后台选深色、系统是浅色时，dark: 组件不生效。
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      // 新增 xl / 3xl 两个断点，让中屏到大屏之间的内容更饱满
      screens: {
        xl: "1280px",   // 常用笔记本分辨率
        "3xl": "1600px", // 15.6 寸大笔记本 / 小显示器
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // 语义状态色（P1 设计令牌）：success/warning/error/info + 浅底（attached to soft）
        success: {
          DEFAULT: "hsl(var(--success))",
          soft: "hsl(var(--success-soft))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          soft: "hsl(var(--warning-soft))",
        },
        error: {
          DEFAULT: "hsl(var(--error))",
          soft: "hsl(var(--error-soft))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          soft: "hsl(var(--info-soft))",
        },
      },
      borderRadius: {
        // shadcn 圆角接入设计令牌（值为既有视觉，不产生回归）：
        //   卡片/大块面(lg)=radius-md · 控件(md)=radius-sm · 小徽标(sm)=radius-xs
        lg: "var(--radius-md)",
        md: "var(--radius-sm)",
        sm: "var(--radius-xs)",
        // 大卡片/弹层：取代 tailwind 默认 12px(xl)/16px(2xl)，收口到令牌刻度(lg/xl)
        xl: "var(--radius-lg)",
        "2xl": "var(--radius-xl)",
      },
      /* ===== 动效令牌（按钮与可点元素的统一微交互）=====
         spring —— 轻微回弹，用于 hover 上浮 / 按压回落。
         投影复用 globals.css 的 --shadow-* 令牌，避免同一数值散落两处。
         注：按压态一律用**过渡**表达（见 components/ui/button.tsx），不用 keyframes 动画 ——
         animation 会整体接管 transform，丢掉悬停位移，还会因默认 fill-mode: none
         在动画结束时弹回，实测会在按下与松开瞬间各产生一次 1px 跳变。 */
      transitionTimingFunction: {
        spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
      boxShadow: {
        // 悬停抬升：与 .card-glass:hover 同源
        lift: "var(--shadow-4)",
        // 主按钮悬停：主色辉光，在颜色变化之外再给一层"可点击"暗示
        "lift-accent": "0 6px 18px -6px hsl(var(--primary) / 0.45)",
      },
    },
  },
  plugins: [tailwindAnimate],
};

export default config;
