/**
 * 图标 / 封面值解析工具（前后端共用，纯函数）
 *
 * 支持的值形态：
 * - 图标名：iconfont symbol（如 icon-github）、lucide（lucide:github）
 * - 图片：http(s):// 外链、/api/uploads/ 媒体库路径
 */

/** 内联 SVG 危险构造的匹配模式。
 *
 * 【VULN-02 修复】关键点在于 SVG 属性**可以省略引号**（`<svg onload=alert(1)>`），
 * 也可以用 `/` 代替空格分隔（`<svg/onload=alert(1)>`）。
 * 早期实现只匹配「空格 + 双引号」一种写法，上述两种变体可直接绕过清洗，
 * 形成存储型 XSS（管理员从不可信来源粘贴图标 → 全体访客中招），故此处统一覆盖三种形态。
 *
 * 说明：检测用不加 `g` 标志（避免 RegExp 实例的 lastIndex 状态污染），清洗用加 `g` 一次性替换。
 */
const SVG_EVENT_ATTR_SRC = "(?:\\s|/)(on[\\w:-]*)\\s*=\\s*(?:\"[^\"]*\"|'[^']*'|[^\\s>]+)";
const SVG_URL_ATTR_SRC = "(?:\\s|/)((?:xlink:)?(?:href|src))\\s*=\\s*(?:\"[^\"]*\"|'[^']*'|[^\\s>]+)";
const SVG_STYLE_ATTR_SRC = "(?:\\s|/)style\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|[^\\s>]+)";
/** 检测用（无 g）：命中即判定为注入意图 */
const SVG_EVENT_ATTR_TEST_RE = new RegExp(SVG_EVENT_ATTR_SRC, "i");
/** 清洗用（带 g） */
const SVG_EVENT_ATTR_G_RE = new RegExp(SVG_EVENT_ATTR_SRC, "gi");
const SVG_URL_ATTR_G_RE = new RegExp(SVG_URL_ATTR_SRC, "gi");
const SVG_STYLE_ATTR_G_RE = new RegExp(SVG_STYLE_ATTR_SRC, "gi");
/** 危险子标签（成对出现）：连同内容整体移除 */
const SVG_DANGEROUS_PAIR_TAG_G_RE =
  /<\s*(?:script|style|iframe|object|embed|foreignobject|animate|set)\b[\s\S]*?<\s*\/\s*(?:script|style|iframe|object|embed|foreignobject|animate|set)\s*>/gi;
/**
 * 危险子标签（自闭合 / 单标签形式，如 `<animate attributeName="href" values="..."/>`）：
 * 这类标签没有闭合标签，必须单独清除，否则 SMIL 动画可被用来改写链接目标。
 * style 不在此列——其正文可能含 `>`（如 `.a > .b{}`），交由上方的成对规则处理。
 */
const SVG_DANGEROUS_SELF_TAG_G_RE =
  /<\s*(?:script|iframe|object|embed|foreignobject|animate|set)\b[^>]*?\/?>/gi;
/** style 属性值中的危险构造 */
const SVG_UNSAFE_STYLE_RE = /url\s*\(|expression\s*\(|javascript\s*:|vbscript\s*:|behavior\s*:/i;

/**
 * 判断值是否为「内联 SVG 代码」（以 <svg 开头的一整段可粘贴图标）。
 * 仅接受以 <svg 开头的片段，并排除夹杂危险标签/脚本/事件处理器的注入型内容。
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
  // 【VULN-02 修复】正常图标不会携带事件处理器或脚本协议，命中即视为注入意图并拒绝
  if (SVG_EVENT_ATTR_TEST_RE.test(value)) return false;
  if (/(?:javascript|vbscript)\s*:/i.test(value)) return false;
  return true;
}

/**
 * 非 Iconify 的保留前缀：这些形态本身带冒号（lucide:xxx、http://…），
 * 若不做排除会被 Iconify 的正则（prefix:name）误判，导致 lucide 图标被当成在线图标去请求。
 */
const RESERVED_ICON_PREFIXES = [
  "http:",
  "https:",
  "data:",
  "blob:",
  "mailto:",
  "tel:",
  "lucide:",
];

/**
 * 判断值是否为 Iconify 在线图标（prefix:name 格式，如 fa:github、mdi:home、tabler:brand-github）。
 * 注意排除 http(s) 外链与 lucide: 前缀。
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
 * - 移除事件属性（on*）与外链 href/src，兼容带引号 / 无引号 / `/` 分隔三种写法；
 * - 移除 script / style / 内嵌文档 / SMIL 动画等危险子标签；
 * - style 属性仅保留常规声明，命中 url() / expression() / javascript: 等构造时整段移除；
 * - 把 width/height 统一为指定尺寸（后台粘贴的阿里 iconfont 常带 200x200 固定大小，直接注入会撑破布局）。
 */
export function renderInlineSvg(svg: string, size: number): string {
  const safe = svg
    // 移除事件属性（覆盖 <svg onload=… / <svg onload="…" / <svg/onload=… 三种形态）
    .replace(SVG_EVENT_ATTR_G_RE, "")
    // 移除外链 href/src（含 xlink:href）
    .replace(SVG_URL_ATTR_G_RE, "")
    // 移除危险子标签及其内容
    .replace(SVG_DANGEROUS_PAIR_TAG_G_RE, "")
    .replace(SVG_DANGEROUS_SELF_TAG_G_RE, "")
    // style 属性：保留常规声明，命中危险构造或无引号（无法可靠解析）则整段移除
    .replace(SVG_STYLE_ATTR_G_RE, (match: string, dq?: string, sq?: string) => {
      if (!dq && !sq) return "";
      return SVG_UNSAFE_STYLE_RE.test(dq ?? sq ?? "") ? "" : match;
    });
  return safe.replace(/<svg([^>]*)>/, (_m, attrs) => {
    const rest = (attrs || "").replace(/\s(width|height)="[^"]*"/g, "");
    return `<svg${rest} width="${size}" height="${size}">`;
  });
}

/** 远程 SVG 的 href/src 取值匹配（带捕获组：用于按「值」决定放行与否） */
const SVG_URL_ATTR_VALUE_G_RE =
  /(?:\s|\/)((?:xlink:)?(?:href|src))\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

/** 允许保留的地址：页内片段引用与 data:image 内联图；其余（javascript:、外链）一律删除 */
const SVG_SAFE_HREF_RE = /^\s*(?:#|data:image\/)/i;

/**
 * 清洗**来自第三方图源**（Iconify 等）的远程 SVG，随后把根 <svg> 尺寸统一为 size。
 *
 * 与 renderInlineSvg 的唯一差别：**保留安全的 href/src**。
 * 部分图标集用 <use href="#id"> 引用 <defs> 内的图形，一律删除会让这些图标变空白，
 * 因此按值放行（仅 #片段 与 data:image/*），javascript: 与外链依然被剔除。
 *
 * 背景：远程 SVG 是「不可信输入」——图源地址由后台「外部服务」配置，一旦上游被投毒、
 * 被劫持，或管理员误填成第三方地址，未清洗就 innerHTML 注入等于把 XSS 送到每一位访客的页面上。
 * 危险构造的规则常量与 renderInlineSvg 共用同一组，避免两套清洗逻辑各写一份后漂移。
 */
export function sanitizeRemoteSvg(svg: string, size: number): string {
  const safe = svg
    // 事件属性（覆盖 onload="…" / onload=… / <svg/onload=… 三种写法）
    .replace(SVG_EVENT_ATTR_G_RE, "")
    // 危险子标签（成对 + 自闭合形态）
    .replace(SVG_DANGEROUS_PAIR_TAG_G_RE, "")
    .replace(SVG_DANGEROUS_SELF_TAG_G_RE, "")
    // 危险 style
    .replace(SVG_STYLE_ATTR_G_RE, (match: string, dq?: string, sq?: string) => {
      if (!dq && !sq) return "";
      return SVG_UNSAFE_STYLE_RE.test(dq ?? sq ?? "") ? "" : match;
    })
    // href/src 按值放行
    .replace(
      SVG_URL_ATTR_VALUE_G_RE,
      (match: string, _name: string, dq?: string, sq?: string, bare?: string) => {
        const value = dq ?? sq ?? bare ?? "";
        return SVG_SAFE_HREF_RE.test(value) ? match : "";
      }
    );
  return safe.replace(/<svg([^>]*)>/, (_m, attrs) => {
    const rest = (attrs || "").replace(/\s(width|height)="[^"]*"/g, "");
    return `<svg${rest} width="${size}" height="${size}">`;
  });
}

/**
 * 解析「图片型」图标 / 封面值 → 可渲染的图片地址。
 * - http(s):// 外链 → 原样返回
 * - 以 / 开头的本地/站点内路径（/images/xxx.png、/api/uploads/... 等）→ 原样返回
 * - 内联 SVG / Iconify（prefix:name）/ 纯图标名 → null，由调用方走图标渲染分支
 */
export function resolveIconImageSrc(value: string): string | null {
  if (!value) return null;
  if (isInlineSvgValue(value) || isIconifyValue(value)) return null;
  if (/^https?:\/\//i.test(value)) return value;
  // 站点内相对路径：任意 / 开头的路径都当作本地图片，保证 /icon.svg、/assets/logo.webp 等可用。
  if (isLocalImagePath(value)) return value;
  return null;
}

/** 判断是否为站点内本地/媒体图片路径（以 / 开头，排除协议相对地址 //host） */
export function isLocalImagePath(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//");
}