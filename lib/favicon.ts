import { assertPublicHttpUrl, fetchFollowingSafeRedirects } from "@/lib/ssrf";

/**
 * 网站图标（favicon）自动探测：
 * 后台「从网站获取」此前直接拼接 google.com/s2/favicons —— 国内网络通常不可达，
 * 拿到的是打不开的图片。这里改为服务端按优先级依次探测，返回首个**真实可用**的地址。
 */

export interface FaviconCandidate {
  /** 候选图标地址 */
  url: string;
  /** 来源说明（用于后台提示） */
  source: string;
}

/**
 * 从用户输入提取主机名。
 * 兼容三种写法：`github.com`、`https://github.com/sxlb`、`github.com/sxlb`。
 * 非法（含空格、无点、路径穿越等）返回 null。
 */
export function extractHostname(input: string): string | null {
  const raw = input.trim();
  if (!raw || /\s/.test(raw)) return null;
  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withProto);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(host)) return null;
  if (!host.includes(".") || host.startsWith(".") || host.endsWith(".") || host.includes("..")) return null;
  return host;
}

/**
 * 候选图标源，按可靠性排序：
 * 1) 站点自身 /favicon.ico —— 最权威、无第三方依赖
 * 2) favicon.im —— 国内可访问的免费图标服务
 * 3) iowen 图标库 —— 国内常用备用源
 * 4) Google favicon —— 最后兜底（国内可能不可达）
 */
export function faviconCandidates(host: string): FaviconCandidate[] {
  return [
    { url: `https://${host}/favicon.ico`, source: "站点自身 favicon.ico" },
    { url: `https://favicon.im/${host}`, source: "favicon.im" },
    { url: `https://api.iowen.cn/favicon/${host}.png`, source: "iowen 图标库" },
    { url: `https://www.google.com/s2/favicons?domain=${host}&sz=64`, source: "Google favicon（备用）" },
  ];
}

/** octet-stream 图标的体积上限：超过视为异常响应，避免把内存打满 */
const MAX_ICON_BYTES = 512 * 1024;
const REQUEST_HEADERS = { "User-Agent": "qiyun-favicon/1.0", Accept: "image/*,*/*;q=0.8" };

/**
 * 带「逐跳 SSRF 校验」的 GET。
 *
 * `redirect: "follow"` 会静默跟随 3xx，跳转后的地址不再经过校验 —— 攻击者可用一个公网域名
 * 302 到内网/云元数据地址（盲 SSRF）。逐跳校验统一由 lib/ssrf 提供，此处只做「失败即视为
 * 该候选不可用」的降级处理（校验失败 / 跳转超限 / 缺少 Location 一律返回 null）。
 */
async function fetchWithSafeRedirects(url: string, signal: AbortSignal): Promise<Response | null> {
  try {
    const { response } = await fetchFollowingSafeRedirects(url, {
      signal,
      headers: REQUEST_HEADERS,
      cache: "no-store",
    });
    return response;
  } catch {
    return null;
  }
}

/** 统计响应体大小，超过 max 即提前中断，避免异常大响应占满内存 */
async function readBodySize(res: Response, max: number): Promise<number> {
  const reader = res.body?.getReader();
  if (!reader) {
    const buf = await res.arrayBuffer();
    return buf.byteLength;
  }
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value?.byteLength ?? 0;
    if (total > max) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  return total;
}

/** 探测单个候选地址是否返回真实图片（带 SSRF 校验与超时） */
async function isReachable(url: string, timeoutMs: number): Promise<boolean> {
  try {
    const res = await fetchWithSafeRedirects(url, AbortSignal.timeout(timeoutMs));
    if (!res || !res.ok) return false;
    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    if (contentType.startsWith("image/")) return true;
    // 少数站点以 octet-stream 返回图标：读少量数据确认非空且未超上限
    if (contentType.includes("octet-stream")) {
      const size = await readBodySize(res, MAX_ICON_BYTES);
      return size > 0 && size <= MAX_ICON_BYTES;
    }
    // 明确是 HTML（常见于 SPA 把未知路径回落到首页）：视为无效
    return false;
  } catch {
    return false;
  }
}

/** 站点自身图标单独先试时的超时：命中即可立刻返回，不必等第三方源 */
const PRIMARY_TRY_MS = 2500;

/**
 * 按优先级探测候选源，返回首个真实可用的地址；全部不可用返回 null。
 *
 * 策略：先单独探测「站点自身 favicon.ico」（最权威），命中就直接返回；
 * 未命中再把其余第三方源**并行**探测，最后按优先级取第一个成功的 ——
 * 串行探测在慢站点上会叠加成十几秒，接口长时间不响应。
 *
 * 探测前先确认目标主机能解析且为公网地址：否则像 favicon.im 这类服务对
 * 不存在的域名也会返回一张占位图，会把「域名写错」伪装成「已获取到图标」。
 */
export async function probeFavicon(host: string, perTryMs = 4000): Promise<FaviconCandidate | null> {
  try {
    await assertPublicHttpUrl(`https://${host}/`);
  } catch {
    return null;
  }

  const [primary, ...others] = faviconCandidates(host);
  if (await isReachable(primary.url, PRIMARY_TRY_MS)) return primary;

  const results = await Promise.all(others.map((candidate) => isReachable(candidate.url, perTryMs)));
  const index = results.findIndex(Boolean);
  return index >= 0 ? others[index] : null;
}
