/**
 * 站点主题：解析规则与首帧脚本的唯一真源。
 *
 * 同一份判定逻辑有三处消费者，必须给出完全一致的结果，否则会出现「首帧一个色、
 * hydration 后翻成另一个色」的闪烁：
 *
 *   1. 首帧内联脚本 —— 在浏览器解析 HTML、绘制任何内容之前同步执行（见 themeInitScript）；
 *   2. ThemeProvider 运行时 —— hydration 后跟随 theme / bgTheme 变化重算；
 *   3. 服务端 home-data —— 决定把哪个 mode 下发给客户端。
 *
 * 为杜绝「脚本与运行时判定漂移」，tests/lib/theme.test.ts 会真实执行 themeInitScript()
 * 产出的脚本文本，与 resolveDark() 在全部模式 × 信号组合下逐一比对。
 */

/** 主题模式（与后台「主题设置」下拉一致） */
export type ThemeMode = "system" | "time" | "bg" | "light" | "dark";

/** 主题模式白名单：用于校验后台/数据库取值 */
export const THEME_MODES = ["system", "time", "bg", "light", "dark"] as const;

/** 背景明暗（由 Background 组件取色后上报；未取色为 null） */
export type BgTheme = "light" | "dark" | null;

/**
 * 判定深色所需的外部信号。
 * 由调用方注入而非模块内部读取，使解析函数保持纯函数、可被测试穷举。
 */
export interface ThemeSignals {
  /** 系统/浏览器是否偏好深色（prefers-color-scheme: dark） */
  prefersDark: boolean;
  /** 本地时间小时（0-23） */
  hour: number;
  /** 「跟随背景主色」模式下壁纸的明暗；尚未取色时为 null */
  bgTheme: BgTheme;
}

/** 校验任意值是否为合法主题模式（非法值一律回落 system） */
export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === "string" && (THEME_MODES as readonly string[]).indexOf(value) !== -1;
}

/**
 * 判定给定主题模式下是否应启用深色。
 *
 * @param mode    主题模式
 * @param signals 外部信号（系统偏好 / 本地小时 / 背景明暗）
 * @returns       true 表示应给 <html> 加 .dark
 */
export function resolveDark(mode: ThemeMode, signals: ThemeSignals): boolean {
  switch (mode) {
    case "dark":
      return true;
    case "light":
      return false;
    case "time":
      // 6:00-18:00 浅色，其余深色
      return signals.hour < 6 || signals.hour >= 18;
    case "bg":
      // 取色完成前用系统偏好兜底，避免首帧落在相反的色调上（取色完成后自动收敛）
      return signals.bgTheme ? signals.bgTheme === "dark" : signals.prefersDark;
    case "system":
    default:
      return signals.prefersDark;
  }
}

/**
 * 生成「首帧前应用主题」的内联脚本（可直接塞进 <script>）。
 *
 * 为什么手写字符串而不是 function.toString()：脚本会在服务端 SSR 与客户端运行时各生成一次，
 * 只有文本完全一致才能保证 hydration 不发生属性错配；手写常量是唯一稳定的做法。
 * 与 resolveDark 的一致性由单元测试穷举比对兜底。
 *
 * 脚本只处理「不依赖运行时信号」的分支：
 *   - light / dark  → 直接落定；
 *   - time          → 读客户端本地时钟（服务端时区不等于用户时区，必须客户端算）；
 *   - system / bg   → 先按 prefers-color-scheme 落定（bg 取色完成前等同 system）。
 *
 * 刻意不在脚本里订阅 prefers-color-scheme：首帧只负责落色，
 * 后续跟随由 ThemeProvider 的 useEffect 统一负责（带完整清理，不会泄漏监听）。
 *
 * @param mode 后台配置的主题模式
 * @returns    自包含的 IIFE 脚本文本
 */
export function themeInitScript(mode: ThemeMode): string {
  return (
    "(function(){try{var m=" +
    JSON.stringify(mode) +
    ';var d;if(m==="dark"){d=true}else if(m==="light"){d=false}else if(m==="time"){' +
    "var h=new Date().getHours();d=h<6||h>=18}else{" +
    'd=typeof window.matchMedia==="function"&&window.matchMedia("(prefers-color-scheme: dark)").matches}' +
    'var e=document.documentElement;e.classList.toggle("dark",!!d);' +
    'e.style.colorScheme=d?"dark":"light"}catch(_){}})();'
  );
}
