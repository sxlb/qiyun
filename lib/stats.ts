/** 单日统计记录（VisitStat 行） */
export interface DailyStat {
  date: string; // YYYY-MM-DD
  pv: number;
  uv: number;
}

/** 生成 YYYY-MM-DD 前/后偏移日期（东八区固定，与 /api/stats 一致） */
export function shiftDate(base: string, offset: number): string {
  // 用 UTC 承载「东八区日历日」：构造与取值必须同口径。
  // 此前构造用 +08:00、取值用本地 getDate()，容器时区非 UTC+8（Alpine 默认 UTC）时
  // 会把基准日期解析成前一天，导致「昨天」「趋势刻度」「周环比」整体偏移一天。
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * 组装趋势序列：按 base 日期向前取 window 天，缺失日期补零。
 * records 可乱序/超窗，输出严格升序、长度恰为 window。
 */
export function buildDailySeries(
  records: DailyStat[],
  window: number,
  base: string
): DailyStat[] {
  const map = new Map(records.map((r) => [r.date, r]));
  const series: DailyStat[] = [];
  for (let i = window - 1; i >= 0; i--) {
    const date = shiftDate(base, -i);
    const hit = map.get(date);
    series.push(hit ? { date, pv: hit.pv, uv: hit.uv } : { date, pv: 0, uv: 0 });
  }
  return series;
}

/** item 形态：按 (date, hour) 分组的访问计数行 */
export interface DayHourRow {
  date: string; // YYYY-MM-DD
  hour: number; // 东八区小时 0~23
  count: number;
}

export const WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"] as const;
export const WEEKDAY_COUNT = 7;
export const HOURS_PER_DAY = 24;

/**
 * 组装一周时段热力图矩阵：7(周一~周日) × 24(小时)，各 (星期, 小时) 求和。
 * rows 可乱序/多点；日期非法该行跳过。输出每行恒为 24 格。
 */
export function buildWeekHours(rows: DayHourRow[]): number[][] {
  const grid: number[][] = Array.from({ length: WEEKDAY_COUNT }, () =>
    Array<number>(HOURS_PER_DAY).fill(0)
  );
  for (const r of rows) {
    const day = new Date(`${r.date}T00:00:00Z`);
    if (Number.isNaN(day.getTime())) continue;
    const hour = Math.trunc(r.hour);
    if (hour < 0 || hour >= HOURS_PER_DAY) continue;
    const weekday = (day.getUTCDay() + 6) % WEEKDAY_COUNT; // 0=周一 … 6=周日
    grid[weekday][hour] += r.count;
  }
  return grid;
}

/* ==================== 来源构成分桶（深度分析） ==================== */
export type SourceBucketKey = "direct" | "search" | "social" | "external";
export const SOURCE_BUCKET_LABEL: Record<SourceBucketKey, string> = {
  direct: "直接访问",
  search: "搜索引擎",
  social: "社交平台",
  external: "外链",
};

const SEARCH_DOMAINS = [/baidu/, /bing/, /google/, /so\.com/, /sogou/, /sm\.cn/, /yandex/, /duckduckgo/];
const SOCIAL_DOMAINS = [/weibo/, /weixin/, /qq\.com/, /zhihu/, /bilibili/, /douyin/, /xiaohongshu/, /x\.com/, /twitter/, /facebook/, /instagram/, /youtube/, /reddit/, /telegram/, /tiktok/];

/** 把 referrerDomain 归为 直接/搜索引擎/社交/外链 */
export function sourceBucket(domain: string): SourceBucketKey {
  if (!domain) return "direct";
  if (SEARCH_DOMAINS.some((r) => r.test(domain))) return "search";
  if (SOCIAL_DOMAINS.some((r) => r.test(domain))) return "social";
  return "external";
}

/* ==================== 周环比（深度分析） ==================== */
/** 返回 base 所在周的周一（YYYY-MM-DD，周一为一周起点；周日属上一周） */
export function mondayOf(base: string): string {
  // 与 shiftDate 同口径：用 UTC 承载东八区日历日，避免依赖进程本地时区
  const jsDay = new Date(`${base}T00:00:00Z`).getUTCDay();
  const offset = jsDay === 0 ? 6 : jsDay - 1;
  return shiftDate(base, -offset);
}

/** 周环比增幅（%）：prev 为基准；prev=0 时按 cur>0 记为 +100，否则 0；避免 -0 */
export function weekDelta(cur: number, prev: number): number {
  const r = prev > 0 ? Math.round(((cur - prev) / prev) * 100) : cur > 0 ? 100 : 0;
  return r === 0 ? 0 : r;
}

// ===== 以下导出来自 ua.ts（已合并）：User-Agent 解析与来源域名提取 =====

/** 解析后的访问维度 */
export interface UaInfo {
  device: "desktop" | "mobile" | "tablet";
  os: string;
  browser: string;
}

/**
 * 从 UA 字符串解析设备/系统/浏览器。
 * 顺序敏感：先判平板（避免 iPad iOS 被 Mobile 命中判成手机），再判移动端。
 */
export function parseUserAgent(ua: string): UaInfo {
  if (!ua) return { device: "desktop", os: "", browser: "" };

  let device: UaInfo["device"] = "desktop";
  if (/iPad|Tablet|PlayBook|Silk|Kindle/i.test(ua)) {
    device = "tablet";
  } else if (/Mobi|Android|iPhone|iPod|BlackBerry|Opera Mini|Windows Phone/i.test(ua)) {
    device = "mobile";
  }

  // 系统
  let os = "";
  let m: RegExpMatchArray | null;
  if ((m = ua.match(/Windows NT (\d+\.\d+)/i))) {
    const v = Number(m[1]);
    os = v >= 10 ? "Windows 10/11" : v >= 6.2 ? "Windows 8" : v >= 6.1 ? "Windows 7" : "Windows";
  } else if (/Android (\d[\d.]*)/i.test(ua)) {
    os = "Android " + (ua.match(/Android (\d[\d.]*)/i)?.[1] ?? "");
  } else if (/CPU (iPhone )?OS (\d+[_a-z]*)/i.test(ua)) {
    os = "iOS";
  } else if (/Mac OS X [\d_.]+/i.test(ua)) {
    os = "macOS";
  } else if (/CrOS/i.test(ua)) {
    os = "ChromeOS";
  } else if (/Linux/i.test(ua)) {
    os = /Ubuntu/i.test(ua) ? "Ubuntu" : "Linux";
  } else {
    os = "";
  }

  // 浏览器（顺序：Edge 需在 Chrome 前，Safari 需剔除 Chromium 内核）
  let browser = "";
  if (/Edg[Ae]?\//i.test(ua)) {
    browser = "Edge";
  } else if (/MicroMessenger/i.test(ua)) {
    browser = "微信";
  } else if (/OPR\//i.test(ua)) {
    browser = "Opera";
  } else if (/SamsungBrowser/i.test(ua)) {
    browser = "Samsung 浏览器";
  } else if (/Firefox\//i.test(ua)) {
    browser = "Firefox";
  } else if (/Chrome\//i.test(ua) || /CriOS\//i.test(ua)) {
    browser = "Chrome";
  } else if (/Safari\//i.test(ua)) {
    browser = "Safari";
  } else {
    browser = "";
  }

  return { device, os, browser };
}

/** 从 Referer 提取来源域名（http(s)://host 形式）；非 http 或空返回 ""（直接访问/书签） */
export function extractReferrerDomain(referer: string): string {
  if (!referer) return "";
  try {
    const u = new URL(referer);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "";
  }
}

/** 当前东八区小时（0-23），与 /api/stats 日期口径一致 */
export function nowHour(): number {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return now.getUTCHours();
}

/**
 * 常见爬虫 / 机器人 / 探针的 UA 特征。
 * 覆盖：搜索引擎蜘蛛、社交平台抓取、SEO 工具、监控探活、脚本客户端与无头浏览器。
 */
const BOT_UA_RE =
  /(bot\b|bots\b|crawler|spider|crawling|slurp|facebookexternalhit|embedly|quora link preview|pinterest|bitlybot|vkshare|whatsapp|telegrambot|discordbot|googlebot|bingbot|baiduspider|yandexbot|sogou|360spider|bytespider|petalbot|applebot|semrush|ahrefs|mj12bot|dotbot|uptimerobot|pingdom|statuscake|headlesschrome|lighthouse|pagespeed|python-requests|python-urllib|aiohttp|httpx|curl\/|wget\/|go-http-client|java\/|okhttp|axios\/|node-fetch|undici|libwww-perl|monitor|probe|scanner)/i;

/**
 * 判断 UA 是否属于爬虫 / 机器人 / 探针。
 *
 * 用于统计采集侧过滤：若不区分，搜索引擎蜘蛛、监控探活与各类扫描器都会被计入
 * PV / UV，并被归类进「设备分布」「地域分布」，使后台数字与实际访客量系统性偏离。
 * 空 UA 同样视为非人类流量（正常浏览器必带 UA）。
 */
export function isBotUserAgent(ua: string): boolean {
  const value = (ua || "").trim();
  if (!value) return true;
  return BOT_UA_RE.test(value);
}
