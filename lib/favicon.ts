import { assertPublicHttpUrl, fetchFollowingSafeRedirects } from "@/lib/ssrf";
import { fillTemplate } from "@/lib/external-api";

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
 * 兼容三种写法：`github.com`、`https://github.com/yourname`、`github.com/yourname`。
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
 * 2) 后台「外部服务」配置的自定义 favicon 服务（模板含 {host}）；
 *    填了就等于多插一道「优先第三方源」，内置源仍作为后续回退
 * 3) favicon.im —— 国内可访问的免费图标服务
 * 4) icon.horse —— 返回位图（部分站点只有它拿得到真实图标）
 * 5) xinac 图标库 —— 国内直连、响应快
 * 6) Google favicon —— 最后兜底（国内通常不可达）
 *
 * 注：原第 5 个源 api.iowen.cn 已下线（实测 DNS 无法解析），故替换为 icon.horse / xinac。
 * 上游再失效时不必改代码：后台「外部服务 → favicon 服务」可随时插一个自定义源到最前面。
 *
 * @param customTemplate 自定义 favicon 服务模板，支持 {host} 占位符（留空则跳过）
 */
export function faviconCandidates(host: string, customTemplate?: string): FaviconCandidate[] {
  const candidates: FaviconCandidate[] = [
    { url: `https://${host}/favicon.ico`, source: "站点自身 favicon.ico" },
  ];
  const custom = (customTemplate ?? "").trim();
  if (custom) {
    candidates.push({ url: fillTemplate(custom, { host }), source: "自定义 favicon 服务" });
  }
  candidates.push(
    { url: `https://favicon.im/${host}`, source: "favicon.im" },
    { url: `https://icon.horse/icon/${host}`, source: "icon.horse" },
    { url: `https://api.xinac.net/icon/?url=${host}`, source: "xinac 图标库" },
    { url: `https://www.google.com/s2/favicons?domain=${host}&sz=64`, source: "Google favicon（备用）" },
  );
  return candidates;
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
 *
 * 一并返回 finalUrl：解析「页面声明的图标」时必须用**跳转后**的地址做基准来补全相对路径，
 * 否则 `https://example.com` → `https://www.example.com/` 这类跳转会让 `/icon.png`
 * 被拼到错误的主机上。
 */
async function fetchWithSafeRedirects(
  url: string,
  signal: AbortSignal
): Promise<{ response: Response; finalUrl: string } | null> {
  try {
    return await fetchFollowingSafeRedirects(url, {
      signal,
      headers: REQUEST_HEADERS,
      cache: "no-store",
    });
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
    const hit = await fetchWithSafeRedirects(url, AbortSignal.timeout(timeoutMs));
    if (!hit) return false;
    const { response: res } = hit;
    if (!res.ok) return false;
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

/* ==================== 页面声明的图标（<link rel="icon">） ==================== */

/**
 * 首页 HTML 的采样上限：图标声明一定在 <head> 里，只读前 256KB 足够覆盖。
 * 不设上限会被超大页面（或恶意长响应）拖垮内存。
 */
const MAX_HTML_BYTES = 256 * 1024;

/** 读取响应体文本，最多 maxBytes 字节（超出即截断并取消流） */
async function readBodyText(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) {
    const buf = await res.arrayBuffer();
    return new TextDecoder().decode(buf.slice(0, maxBytes));
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    total += value.byteLength;
    if (total >= maxBytes) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  const merged = new Uint8Array(Math.min(total, maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= merged.length) break;
    const slice = chunk.subarray(0, merged.length - offset);
    merged.set(slice, offset);
    offset += slice.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

/**
 * rel 取值是否表示「图标」。
 * 覆盖 `icon` / `shortcut icon` / `apple-touch-icon` / `apple-touch-icon-precomposed`
 * （大小写不敏感，rel 里单词顺序不限，如 `icon shortcut`）。
 */
const ICON_REL_RE = /(?:^|\s)(?:icon|shortcut\s+icon|apple-touch-icon(?:-precomposed)?)(?:\s|$)/i;

/** 从单个 <link> 标签里取属性值（支持双引号 / 单引号 / 无引号三种写法） */
function readAttr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\b\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i"));
  if (!m) return null;
  return (m[1] ?? m[2] ?? m[3] ?? "").trim();
}

/**
 * 解析首页 HTML 中声明的图标地址。
 *
 * 为什么需要它：不少站点（如把图标放在 OSS/CDN 上的博客）根目录并没有 favicon.ico，
 * 而是在 HTML 里用 `<link rel="icon">` 指向别处。只探测 `/favicon.ico` 会把这类站点
 * 误判成「没有图标」，随后回落到第三方服务——那些服务在国内又常常不可达。
 *
 * 返回按声明顺序去重后的绝对 http(s) 地址；相对路径（`/icon.png`、`icon.png`、
 * `//cdn.x.com/i.png`）一律以 baseUrl 为基准补全。`data:` 等不可探测的协议直接跳过。
 *
 * @param html    首页 HTML 文本
 * @param baseUrl 解析相对路径的基准（应传跳转后的最终地址）
 */
export function extractIconHrefs(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = readAttr(tag, "rel");
    if (!rel || !ICON_REL_RE.test(rel)) continue;
    const href = readAttr(tag, "href");
    if (!href) continue;
    let abs: string;
    try {
      abs = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
    if (!/^https?:\/\//i.test(abs)) continue;
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push(abs);
  }
  return out;
}

/**
 * 探测首页**声明**的图标：先取回 HTML，再逐个校验声明地址是否真的返回图片。
 *
 * 用 Promise.all 并行校验而非串行：声明里常见「先 SVG 再 PNG 再 apple-touch-icon」多条，
 * 串行在慢站点上会把等待叠成好几秒。
 *
 * 失败的任何一种情况（取不到页面 / 非 HTML / 没有声明 / 声明地址都不可用）都返回 null，
 * 由调用方继续走 favicon.ico 与第三方源的既有回退链路。
 */
async function probeDeclaredIcon(
  host: string,
  htmlMs: number,
  iconMs: number
): Promise<FaviconCandidate | null> {
  const pageUrl = `https://${host}/`;
  const page = await fetchWithSafeRedirects(pageUrl, AbortSignal.timeout(htmlMs));
  if (!page || !page.response.ok) return null;
  const contentType = (page.response.headers.get("content-type") || "").toLowerCase();
  // 非 HTML（含站点把根路径直接重定向到图片的情况）没有可解析的声明
  if (!contentType.includes("html")) {
    await page.response.body?.cancel().catch(() => {});
    return null;
  }
  const html = await readBodyText(page.response, MAX_HTML_BYTES);
  const hrefs = extractIconHrefs(html, page.finalUrl || pageUrl);
  if (!hrefs.length) return null;

  const hits = await Promise.all(hrefs.map((url) => isReachable(url, iconMs)));
  const index = hits.findIndex(Boolean);
  return index >= 0 ? { url: hrefs[index], source: "页面声明的图标" } : null;
}

/** 取首页 HTML 的超时：首页通常很快，慢的站点不值得为此拖长整体探测 */
const DECLARED_HTML_MS = 3000;
/** 校验单个「页面声明图标」的超时 */
const DECLARED_ICON_MS = 2500;

/** 站点自身图标单独先试时的超时：命中即可立刻返回，不必等第三方源 */
const PRIMARY_TRY_MS = 2500;

/**
 * 按优先级探测候选源，返回首个真实可用的地址；全部不可用返回 null。
 *
 * 优先级（与浏览器一致：站点声明的图标优先于约定路径）：
 * 1. 首页 HTML 里 `<link rel="icon">` 等声明的图标 —— 最权威，唯一能覆盖
 *    「图标放在 OSS/CDN、根目录没有 favicon.ico」的建站方式
 * 2. 站点自身 `/favicon.ico` —— 没有声明时的通用约定
 * 3. 第三方 favicon 服务（可含后台自定义源）—— 前两者都拿不到时的兜底
 *
 * 第 1、2 步**并行**发起：声明缺失的站点占多数，串行会让每次探测都白等一轮首页请求。
 * 第 3 步仍在两者都落空后才并行探测，避免无谓地打第三方接口。
 *
 * 探测前先确认目标主机能解析且为公网地址：否则像 favicon.im 这类服务对
 * 不存在的域名也会返回一张占位图，会把「域名写错」伪装成「已获取到图标」。
 *
 * @param customTemplate 后台「外部服务」配置的自定义 favicon 服务模板（支持 {host}）
 * @param perTryMs       第三方源的单次探测超时（毫秒）
 */
export async function probeFavicon(
  host: string,
  customTemplate?: string,
  perTryMs = 4000
): Promise<FaviconCandidate | null> {
  try {
    await assertPublicHttpUrl(`https://${host}/`);
  } catch {
    return null;
  }

  // 候选人选：站点自身 → 自定义 favicon 服务（若已配置）→ 内置第三方源
  const [primary, ...others] = faviconCandidates(host, customTemplate);

  const [declared, primaryHit] = await Promise.all([
    probeDeclaredIcon(host, DECLARED_HTML_MS, DECLARED_ICON_MS),
    isReachable(primary.url, PRIMARY_TRY_MS),
  ]);
  if (declared) return declared;
  if (primaryHit) return primary;

  const results = await Promise.all(others.map((candidate) => isReachable(candidate.url, perTryMs)));
  const index = results.findIndex(Boolean);
  return index >= 0 ? others[index] : null;
}
