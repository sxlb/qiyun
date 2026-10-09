/**
 * 地域展示标签的组合规则：欢迎通知（"来自 X"）与天气接口（`region` 字段）共用一份。
 *
 * 为什么不放进 lib/geo.ts 或 lib/weather.ts：
 * - lib/geo.ts 在模块顶层就加载 ip2region（createRequire + node:fs），
 *   而 lib/weather.ts 被纯函数测试直接引入，互相引用会把不必要的依赖链带过去；
 * - 这里只有一个纯函数，单独成文件后两边都能干净地引用。
 */

/** 取第一个非空字符串（外部接口的字段可能是字符串、数组，实测高德会返回数组） */
function firstString(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v)) {
    for (const item of v) {
      if (typeof item === "string" && item.trim()) return item.trim();
    }
  }
  return "";
}

/**
 * 组合「省 + 市」展示标签。
 *
 * - 省市同名时只保留一个：直辖市很常见（province=北京市, city=北京市），
 *   直接拼接会显示成"北京市 北京市"
 * - 市名已含省名时只保留市（如 上海市 / 上海市浦东新区）
 * - 只拿到一级就只显示那一级；两级都拿不到返回空串（调用方据此不展示地域）
 */
export function composeRegionLabel(province?: unknown, city?: unknown): string {
  const p = firstString(province);
  const c = firstString(city);
  if (p && c) return c === p || c.startsWith(p) ? c : `${p} ${c}`;
  return c || p;
}
