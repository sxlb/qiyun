import type { Config } from "tailwindcss";
// 必须用静态 import：本文件会被 Next 以 ESM 加载，ESM 作用域内没有 require，
// 写成 require("tailwindcss-animate") 会在编译路由（如 /api/wallpaper）时抛
// ReferenceError: require is not defined 并直接终止 dev server。
import tailwindAnimate from "tailwindcss-animate";

const config: Config = {
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
    },
  },
  plugins: [tailwindAnimate],
};

export default config;
