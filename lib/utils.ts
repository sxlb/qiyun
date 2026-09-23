import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ===== 以下导出来自 csv.ts（已合并） =====

/** CSV 工具集：单元格转义 + 生成带 UTF-8 BOM 的 CSV 文本（Excel 兼容）。 */

/** 转义单个单元格：含逗号/引号/换行时用双引号包裹，引号翻倍 */
export function csvEscape(value: unknown): string {
  let s = value == null ? "" : String(value);
  // 公式注入防护（CWE-1236）：以 = + - @ 开头的**文本**会被 Excel / 表格软件当公式执行。
  // 纯数字（含负数）是正常数据，不加前缀。
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) {
    s = `'${s}`;
  }
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * 组装完整 CSV 文本（UTF-8 BOM，CRLF 换行）。
 * 供 API 下载端点使用，直接作为响应体返回。
 */
export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers, ...rows].map((r) => r.map(csvEscape).join(","));
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

// ===== 以下导出来自 sanitize.ts（已合并） =====

/**
 * 基础 HTML 清理：仅保留白名单标签 + 安全属性，移除所有 on* 事件属性和危险协议 URL。
 * 纯函数、无服务端依赖，供 SSR、CSR 和 API 路由共用。
 */

const SAFE_TAGS = new Set([
  "div", "p", "span", "br", "hr", "strong", "em", "u", "s", "del",
  "a", "code", "pre", "blockquote",
]);
const SAFE_ATTRS = new Set(["href", "title", "rel", "target"]);
const ALLOWED_HREF_PROTOCOLS = new Set(["http", "https", "mailto", "tel"]);
const ON_RE = /^on/i;

export function sanitizeHtml(raw: string): string {
  if (!raw) return "";
  const safe = raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // 属性段允许出现 `&amp;`（转义阶段把 & 变成了 &amp;，否则含 & 的属性整段匹配不上、
  // 标签无法被还原，页脚会直接显示出源码）
  return safe.replace(/&lt;(\/?)([\w-]+)((?:&amp;|[^&])*?)&gt;/g, (_fullMatch: string, slash: string, tag: string, attrs: string) => {
    const lowerTag = tag.toLowerCase();
    if (!SAFE_TAGS.has(lowerTag)) return "";
    // 闭合标签只保留标签名：`</p>` 不能退化成 `<p>`（否则标签永不闭合、后续兄弟节点被吞进容器）
    if (slash) return `</${lowerTag}>`;
    const filteredAttrs = attrs.replace(/\s+([\w-]+)(?:=(".*?"|'.*?'|\S+))?/g, (_m: string, attrName: string, attrVal: string | undefined) => {
      const la = attrName.toLowerCase();
      if (la.startsWith("data-")) return ` ${la}`;
      if (ON_RE.test(la)) return "";
      if (!SAFE_ATTRS.has(la)) return "";
      const sanitizedVal = attrVal != null ? attrVal.replace(/^["']|["']$/g, "") : "";
      if (attrVal != null && ["href", "src"].includes(la) && !ALLOWED_HREF_PROTOCOLS.has(sanitizedVal.split(":")[0].toLowerCase())) {
        return "";
      }
      return attrVal ? ` ${la}="${sanitizedVal}"` : ` ${la}`;
    });
    return `<${lowerTag}${filteredAttrs}>`;
  });
}
