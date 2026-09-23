/**
 * 图标 / 封面值解析工具（前后端共用，纯函数）
 *
 * 支持的值形态：
 * - 图标名：iconfont symbol（如 icon-github）、lucide（lucide:github）
 * - 图片：http(s):// 外链、/api/uploads/ 媒体库路径
 * - 随机图：random:关键词（当前写法）
 *
 * 说明：旧前缀 `unsplash:关键词` 中依赖的 source.unsplash.com 已停止服务（返回 503），
 * 现统一改用 loremflickr 关键词随机图；旧前缀仅作兼容识别，避免历史数据渲染成破图。
 */

/** 随机图值前缀（当前写法） */
export const RANDOM_PREFIX = "random:";
/** 旧随机图前缀（source.unsplash.com 已停服，仅兼容识别） */
export const LEGACY_RANDOM_PREFIX = "unsplash:";

/** 判断是否为随机图值（兼容新旧前缀） */
export function isRandomImageValue(value: string): boolean {
  return value.startsWith(RANDOM_PREFIX) || value.startsWith(LEGACY_RANDOM_PREFIX);
}

/** 从随机图值中提取关键词（无关键词时返回空串） */
export function extractRandomKeyword(value: string): string {
  if (value.startsWith(RANDOM_PREFIX)) return value.slice(RANDOM_PREFIX.length);
  if (value.startsWith(LEGACY_RANDOM_PREFIX)) return value.slice(LEGACY_RANDOM_PREFIX.length);
  return "";
}

/**
 * 按关键词生成随机图直链。
 * 使用 loremflickr（Flickr 图源，无需 API Key），每次请求可能返回不同图片，
 * 适合「未设置封面图时随机展示」的场景；如需可控版权的图片请使用 Openverse 搜索并保存直链。
 */
export function getRandomImageUrl(keyword: string, width: number, height: number = width): string {
  const kw = encodeURIComponent(keyword.trim() || "random");
  return `https://loremflickr.com/${width}/${height}/${kw}`;
}

/**
 * 判断值是否为「内联 SVG 代码」（以 <svg 开头的一整段可粘贴图标）。
 * 仅接受以 <svg 开头的片段，并排除夹杂危险标签/脚本的注入型内容。
 */
export function isInlineSvgValue(value: string): boolean {
  if (!value) return false;
  const trimmed = value.trimStart();
  if (!trimmed.startsWith("<svg")) return false;
  // 逐标签检测：排除可能导致 XSS 或样式注入的非白名单 SVG 子标签
  if (/<\s*script\b/i.test(value)) return false;
  if (/<\s*foreignobject\b/i.test(value)) return false;
  if (/<\s*(?:animate|set)\b/i.test(value)) return false;
  if (/<\s*a\s+(?![\/>])/i.test(value)) return false; // <a> 不带 /> 终止符视为非自闭合链接
  return true;
}

/**
 * 非 Iconify 的保留前缀：这些形态本身带冒号（lucide:xxx、random:city、http://…），
 * 若不做排除会被 Iconify 的正则（prefix:name）误判，导致 lucide 图标被当成在线图标去请求。
 */
const RESERVED_ICON_PREFIXES = [
  "http:",
  "https:",
  "data:",
  "blob:",
  "mailto:",
  "tel:",
  "random:",
  "unsplash:",
  "lucide:",
];

/**
 * 判断值是否为 Iconify 在线图标（prefix:name 格式，如 fa:github、mdi:home、tabler:brand-github）。
 * 注意排除 http(s) 外链、lucide: 前缀与 random:/unsplash: 随机图前缀。
 */
export function isIconifyValue(value: string): boolean {
  if (typeof value !== "string" || !value) return false;
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  if (RESERVED_ICON_PREFIXES.some((p) => lower.startsWith(p))) return false;
  return /^[a-z0-9-]+:[a-z0-9-]+$/i.test(trimmed);
}

/**
 * 将内联 SVG 代码规范化为页面可安全注入的形式：
 * - 移除 <script> 之外的事件属性（on*）、外链 href/src，防止注入；
 * - 把 width/height 统一为指定尺寸（后台粘贴的阿里 iconfont 常带 200x200 固定大小，直接注入会撑破布局）。
 */
export function renderInlineSvg(svg: string, size: number): string {
  const safe = svg
    // 移除事件属性（兼容空格或 / 分隔的形态：<svg onload=... 或 <svg/onload=...）
    .replace(/(\s|\/)on\w+\s*=\s*(["']).*?\2/gi, "")
    // 移除外链 href/src
    .replace(/(\s|\/)(?:href|src)\s*=\s*(["']).*?\2/gi, "");
  return safe.replace(/<svg([^>]*)>/, (_m, attrs) => {
    const rest = (attrs || "").replace(/\s(width|height)="[^"]*"/g, "");
    return `<svg${rest} width="${size}" height="${size}">`;
  });
}

/**
 * 解析「图片型」图标 / 封面值 → 可渲染的图片地址。
 * - random: / unsplash: 关键词 → 随机图直链
 * - http(s):// 外链 → 原样返回
 * - 以 / 开头的本地/站点内路径（/images/xxx.png、/api/uploads/... 等）→ 原样返回
 * - 内联 SVG / Iconify（prefix:name）/ 纯图标名 → null，由调用方走图标渲染分支
 */
export function resolveIconImageSrc(value: string, size: number): string | null {
  if (!value) return null;
  if (isInlineSvgValue(value) || isIconifyValue(value)) return null;
  if (isRandomImageValue(value)) return getRandomImageUrl(extractRandomKeyword(value), size);
  if (/^https?:\/\//i.test(value)) return value;
  // 站点内相对路径：Vue 版（home 项目）对「非预设名 / 非 iconify」的值一律当图片地址处理，
  // 这里同样放宽到任意 / 开头的路径，保证 /icon.svg、/assets/logo.webp 等本地图片可用。
  if (isLocalImagePath(value)) return value;
  return null;
}

/** 判断是否为站点内本地/媒体图片路径（以 / 开头，排除协议相对地址 //host） */
export function isLocalImagePath(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//");
}

// ===== 以下导出来自 iconPreset.ts（已合并） =====

/**
 * @vicons/fa 预设图标名映射（前后台共用，纯数据 + 纯函数）
 *
 * @vicons/fa 预设名 → lucide 白名单内的 kebab 图标名
 */
export const FA_PRESET_TO_LUCIDE: Record<string, string> = {
  Blog: "newspaper",
  Cloud: "cloud",
  CompactDisc: "disc",
  Compass: "compass",
  Book: "book",
  Fire: "flame",
  LaptopCode: "code",
};

/** 全部预设名（供后台做快捷选择与占位提示，顺序与映射表一致） */
export const FA_PRESET_NAMES: string[] = Object.keys(FA_PRESET_TO_LUCIDE);

/**
 * 判断某个值是否为 @vicons/fa 预设名，是则返回对应的 lucide kebab 名，否则返回 null。
 * 大小写敏感：仅匹配历史数据的 PascalCase 写法，避免把 "blog" / "cloud"
 * 这类普通 lucide 图标名误判成预设名（它们本身就能直接解析）。
 */
export function resolveFaPresetLucideName(value: string | null | undefined): string | null {
  if (!value) return null;
  return FA_PRESET_TO_LUCIDE[value.trim()] ?? null;
}
