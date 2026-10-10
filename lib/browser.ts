/**
 * 浏览器识别（User-Agent 嗅探）—— 访问统计与前台欢迎语共用同一份判定，
 * 避免「统计里归成 Chrome、欢迎语里说成 Safari」这类自相矛盾。
 *
 * **顺序即优先级**：现代浏览器的 UA 是「套娃」结构 —— Edge 的 UA 里同时含
 * `Chrome/` 与 `Safari/`，Chrome 的 UA 里含 `Safari/`。所以必须从最特殊的标识
 * 判到最通用的，把 Safari 留在最后兜底；顺序一反，Edge 会被判成 Chrome、
 * Chrome 会被判成 Safari。
 *
 * 适用边界：只用于**分类展示**（统计里的浏览器分布、欢迎语的「来自 Edge」）。
 * UA 正在被冻结（Safari 已把版本号固定成 `605.1.15`、平台固定成 `Mac OS X 10_15_7`），
 * 不要用它解析精确版本；若需按浏览器切换功能，请改用特性检测
 * （如 `'geolocation' in navigator`、`CSS.supports()`）。
 */

/** 识别浏览器展示名；无法识别时返回空字符串，由调用方决定占位文案 */
export function detectBrowser(ua: string): string {
  if (!ua) return "";

  // 套壳与国产浏览器排最前：它们同样基于 Chromium，UA 里也带 Chrome/Safari 标识，
  // 放到后面会被更通用的分支截胡
  if (/MicroMessenger/i.test(ua)) return "微信浏览器";
  if (/QQBrowser/i.test(ua)) return "QQ 浏览器";
  if (/UCBrowser|UBrowser/i.test(ua)) return "UC 浏览器";
  if (/Quark/i.test(ua)) return "夸克";
  if (/BIDUBrowser|BaiduBrowser/i.test(ua)) return "百度浏览器";
  if (/HuaweiBrowser/i.test(ua)) return "华为浏览器";
  if (/MiuiBrowser/i.test(ua)) return "小米浏览器";
  if (/QihooBrowser|QIHU 360/i.test(ua)) return "360 浏览器";
  if (/MetaSr|SogouMobileBrowser/i.test(ua)) return "搜狗浏览器";
  if (/SamsungBrowser/i.test(ua)) return "Samsung 浏览器";

  // Chromium 系里带自家标识的分支，同样要早于 Chrome 判断。
  // 移动端标识与桌面不同，漏掉变体就会掉到后面的分支去
  if (/Edg(?:A|iOS)?\//i.test(ua)) return "Edge"; // Edg/ · EdgA/ · EdgiOS/
  if (/OP(?:R|iOS)\//i.test(ua)) return "Opera"; // OPR/ · OPiOS/
  if (/Firefox\/|FxiOS\//i.test(ua)) return "Firefox"; // Firefox/ · FxiOS/
  if (/Chrome\/|CriOS\//i.test(ua)) return "Chrome"; // Chrome/ · CriOS/

  // 兜底：Chromium 系已在上面被截胡，走到这里只可能是 WebKit/Safari
  if (/Safari\//i.test(ua)) return "Safari";
  return "";
}

/** 读取当前环境的浏览器名；SSR（无 navigator）时返回空字符串 */
export function detectCurrentBrowser(): string {
  if (typeof navigator === "undefined") return "";
  return detectBrowser(navigator.userAgent);
}
