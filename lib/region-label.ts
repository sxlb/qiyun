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
 * 组合「省 + 市 + 区」展示标签（逐级去重）。
 *
 * - 与上一级同名时只保留更细的一级：直辖市很常见（province=北京市, city=北京市），
 *   直接拼接会显示成"北京市 北京市"；此时区级仍会追加，得到"北京市 东城区"
 * - 本级名已含上一级名时同样只保留本级（如 上海市 / 上海市浦东新区）
 * - 中间某级缺失时跳过该级，不阻断更细的一级（只有省 + 区时输出"江苏省 海陵区"）
 * - 全空返回空串（调用方据此不展示地域）
 *
 * 三级都参与是刻意的：区级只有逆地理编码（浏览器精确定位）与腾讯 IP 库的
 * `district` 字段能给到，离线库 ip2region 天花板是市级 —— 拿不到就自然退回两级。
 */
export function composeRegionLabel(province?: unknown, city?: unknown, district?: unknown): string {
  const levels = [firstString(province), firstString(city), firstString(district)];
  const out: string[] = [];
  for (const level of levels) {
    if (!level) continue;
    const prev = out[out.length - 1];
    // 与上一级重复（直辖市省市同名）：用更细的一级顶替，而不是并列
    if (prev && (level === prev || level.startsWith(prev))) {
      out[out.length - 1] = level;
      continue;
    }
    out.push(level);
  }
  return out.join(" ");
}
