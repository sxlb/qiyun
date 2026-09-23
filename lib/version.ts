import path from "node:path";
import { promises as fs } from "node:fs";
import packageJson from "../package.json";

/**
 * 版本与发布检测：
 * - CURRENT_VERSION 在构建时由 package.json 版本号内联（Next 会打包 JSON），
 *   因此运行时（含 standalone 产物）无需依赖 package.json 文件即可获得当前版本。
 * - fetchLatestRelease 通过 GitHub Releases API 探测远端最新版本，用于"检测到新版本"。
 */

/**
 * 当前应用版本。
 * 优先取宿主机记录的已部署版本（APP_VERSION，由部署方注入，形如 home-2026-8-26-01-19-01），
 * 缺省回退 package.json 的语义化版本。二者均用于"是否有新版本"的判断基准。
 */
export const CURRENT_VERSION = process.env.APP_VERSION || packageJson.version;

export const GITHUB_REPO = "sxlb/qiyun";

/** 一次发布的概要信息（来自 GitHub Releases API） */
export interface ReleaseInfo {
  tag: string; // 如 v1.2.0
  version: string; // 标准化后的版本号，如 1.2.0
  name: string;
  body: string; // 发布说明（Markdown）
  htmlUrl: string;
  publishedAt: string; // ISO 时间
}

/** 将 git tag 规范化为无 v 前缀的版本号（v1.2.0 -> 1.2.0） */
export function normalizeVersion(tag: string): string {
  return String(tag || "").replace(/^v/i, "");
}

/** home-时间戳 tag 的分段提取：home-2026-8-26-01-19-01 -> [2026,8,26,1,19,1]；非该格式返回 null */
function timestampParts(tag: string): number[] | null {
  const m = /^home-(\d{4})-(\d{1,2})-(\d{1,2})-(\d{1,2})-(\d{1,2})-(\d{1,2})$/i.exec(String(tag || "").replace(/^v/i, ""));
  if (!m) return null;
  return m.slice(1).map(Number);
}

/** 判断是否为 home-时间戳 发布的 tag */
export function isTimestampTag(tag: string): boolean {
  return timestampParts(tag) !== null;
}

/**
 * 语义化版本比较（最多取前 3 段）：
 * 返回 a>b:1, a<b:-1, 相等:0。非法段按 0 处理，便于前端做"是否有新版本"判断。
 * 若两者均为本仓库的 home-时间戳 tag（home-YYYY-M-D-HH-MM-SS），按时间先后比较。
 */
export function compareVersions(a: string, b: string): number {
  const ta = timestampParts(a);
  const tb = timestampParts(b);
  if (ta || tb) {
    // 出现时间戳 tag 时：仅当另一方也是时间戳才可精确比较；
    // 一方非时间戳视为"早期/未知"版本（时间戳视为较新），避免误判无更新。
    if (!ta) return -1;
    if (!tb) return 1;
    for (let i = 0; i < 6; i++) {
      if (ta[i] > tb[i]) return 1;
      if (ta[i] < tb[i]) return -1;
    }
    return 0;
  }
  const pa = String(a || "").replace(/^v/i, "").split(".").slice(0, 3).map((n) => parseInt(n, 10));
  const pb = String(b || "").replace(/^v/i, "").split(".").slice(0, 3).map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/** 判断远端 tag 是否为"较新版本"（标准化后比较） */
export function isNewerRelease(tag: string, current = CURRENT_VERSION): boolean {
  return compareVersions(normalizeVersion(tag), current) > 0;
}

/* ---------------- GitHub Releases 探测（含内存缓存，防触发限流） ---------------- */

interface FetchCache {
  at: number;
  data: ReleaseInfo | null;
  error?: string;
}

/** 进程级缓存（单实例部署适用）：避免频繁请求 GitHub API 触发 60 次/小时限流 */
const globalCache: Record<string, FetchCache | undefined> =
  (globalThis as unknown as { __updateReleaseCache?: Record<string, FetchCache> }).__updateReleaseCache ??= {};

const CACHE_TTL_MS = 10 * 60 * 1000; // 成功结果 10 分钟
// 错误（超时/网络抖动）短 TTL：临时性问题应快速自愈，避免用户反复点"检查更新"却一直拿到旧错误
const ERROR_CACHE_TTL_MS = 30 * 1000;

/** 自动清理过期缓存条目，防止热更新环境下长期运行后缓存与实际不符 */
function clearGlobalCache(): void {
  const now = Date.now();
  for (const key of Object.keys(globalCache)) {
    const entry = globalCache[key];
    if (!entry) {
      delete globalCache[key];
    } else if (now - entry.at > CACHE_TTL_MS && !entry.error) {
      delete globalCache[key];
    } else if (now - entry.at > ERROR_CACHE_TTL_MS && entry.error) {
      delete globalCache[key];
    }
  }
}

/* ---------------- 版本缓存（持久化，容器与宿主机同卷共享） ---------------- */
// 版本缓存记录"最近一次成功拉到的最新 GitHub release"，文件与 prod.db 同数据卷：
// 容器内 /app/data/latest.json == 宿主机 <DATA_DIR>/latest.json（同一 mount）。
// 刷新来源：
//   1. 容器"登录后台"时按需刷新（短时去重，见 refreshVersionCacheOnLogin）；
//   2. 容器"点击检测更新"时强制刷新（force=true）；
//   3. 宿主机 cron（update-watch.sh）兜底每日刷新一次（宿主机出网更稳）。
// /app/data 由数据卷映射且容器非 root 用户可写，故文件放在 data/ 下而非 data/deploy/。
// 路径在「调用时」解析而非模块加载时固化：生产环境 DATA_DIR 恒定，行为完全不变；
// 但测试可通过 DATA_DIR 指向临时目录来隔离本机 data/latest.json，避免用例依赖机器状态。
function versionCacheFile(): string {
  return process.env.DATA_DIR
    ? path.join(process.env.DATA_DIR, "latest.json")
    : path.join(process.cwd(), "data", "latest.json");
}
// 缓存"新鲜"判定阈值：新的定时/登录刷新入口在上次刷新超过该时长后才真正拉取
const VERSION_CACHE_TTL_MS = 10 * 60 * 1000;

interface VersionCacheDoc {
  timestamp: number;
  data: ReleaseInfo | null;
  error?: string;
}

/** 读取版本缓存；文件缺失/损坏/无时间戳时返回 null（不影响网络竞速兜底） */
async function readVersionCache(): Promise<VersionCacheDoc | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(versionCacheFile(), "utf8")) as {
      timestamp?: number;
      data?: ReleaseInfo | null;
      error?: string;
    };
    if (!parsed || typeof parsed.timestamp !== "number") return null;
    return { timestamp: parsed.timestamp, data: parsed.data ?? null, error: parsed.error };
  } catch {
    return null;
  }
}

/* ---------------- GitHub API 多源（官方优先，失败降级公共代理）+ 测速选源 ---------------- */

const OFFICIAL_BASE = "https://api.github.com";

/**
 * 内置公共加速代理（后台「系统更新 → GitHub 加速代理」里会逐个测连通性）。
 *
 * ⚠️ base 必须自带上游完整地址：releaseUrl() 会直接在其后拼 "repos/..."，
 * 因此要写成 https://gh-proxy.com/https://api.github.com/（实测 200），
 * 而 https://gh-proxy.com/ 会拼出 https://gh-proxy.com/repos/... → 403（Cloudflare Error 1000）。
 */
const BUILTIN_MIRRORS: string[] = [
  "https://edgeone.gh-proxy.com/https://api.github.com/",
  "https://hk.gh-proxy.com/https://api.github.com/",
  "https://gh-proxy.com/https://api.github.com/",
  "https://gh.dpik.top/https://api.github.com/",
];

const RELEASE_HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

const OFFICIAL_TIMEOUT_MS = 5000; // 官方源很快（实测约 0.6s），超时给紧一点
const MIRROR_TIMEOUT_MS = 10000; // 公共镜像慢得多（实测 3.5s~7s，出网拥堵时更慢），超时放宽
const MAX_ROUNDS = 2; // 竞速总轮数：首轮失败后短暂间隔重试，抵御服务器出网间歇性丢包
const ROUND_GAP_MS = 300; // 轮次间间隔

/** 候选源类别：official=GitHub 官方；builtin=内置代理；env=环境变量指定；custom=后台自定义 */
export type ProxyScope = "official" | "builtin" | "env" | "custom";

export interface ProxySource {
  /** 可直接拼接 repos/... 的 base */
  base: string;
  scope: ProxyScope;
  /** 是否为后台指定的优先代理（优先代理会先单独探测，成功即用） */
  preferred?: boolean;
}

/**
 * 把用户/环境变量里填的地址规范成「可拼接 repos/... 的 base」：
 * - 非 http(s) 或空 → null（视为非法，忽略）
 * - 已含 api.github.com（直连 API 镜像）→ 仅补结尾斜杠
 * - 只是代理前缀（如 https://hk.gh-proxy.com）→ 自动补上游 https://api.github.com/
 */
export function normalizeMirrorBase(input: string): string | null {
  const raw = (input || "").trim();
  if (!raw || !/^https?:\/\//i.test(raw)) return null;
  const withSlash = raw.endsWith("/") ? raw : `${raw}/`;
  if (/api\.github\.com/i.test(withSlash)) return withSlash;
  return `${withSlash}https://api.github.com/`;
}

/** 代理地址的可读名（取域名，便于后台展示与日志） */
export function mirrorLabel(base: string): string {
  try {
    return new URL(base).host;
  } catch {
    return base;
  }
}

/** 内置代理：GITHUB_API_MIRRORS 提供时以它为准（运维可整组替换），否则用内置列表 */
function configuredMirrors(): { bases: string[]; scope: ProxyScope } {
  const raw = (process.env.GITHUB_API_MIRRORS || "").trim();
  if (!raw) return { bases: BUILTIN_MIRRORS, scope: "builtin" };
  const bases = raw
    .split(",")
    .map((s) => normalizeMirrorBase(s))
    .filter((s): s is string => Boolean(s));
  return { bases, scope: "env" };
}

/** 自定义代理持久化文件（与版本缓存同数据卷，容器重启后仍生效；不引入数据库表） */
function mirrorsFilePath(): string {
  const dir = process.env.DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, "github-mirrors.json");
}

/** 持久化结构：自定义代理列表 + 后台指定的优先代理（preferred 为空表示全源自动竞速） */
interface ProxyStore {
  mirrors: string[];
  preferred: string | null;
}

/** 读取持久化文件（缺失/损坏返回空结构，不影响内置代理兜底） */
async function readProxyStore(): Promise<ProxyStore> {
  try {
    const parsed = JSON.parse(await fs.readFile(mirrorsFilePath(), "utf8")) as {
      mirrors?: unknown;
      preferred?: unknown;
    };
    const mirrors = Array.isArray(parsed?.mirrors)
      ? parsed.mirrors.map((m) => normalizeMirrorBase(String(m))).filter((m): m is string => Boolean(m))
      : [];
    const preferredRaw = typeof parsed?.preferred === "string" ? parsed.preferred : "";
    const preferred = preferredRaw ? normalizeMirrorBase(preferredRaw) : null;
    return { mirrors, preferred };
  } catch {
    return { mirrors: [], preferred: null };
  }
}

/** 原子写入持久化文件（返回是否成功，失败不影响内置代理继续工作） */
async function writeProxyStore(store: ProxyStore): Promise<boolean> {
  try {
    const file = mirrorsFilePath();
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(store, null, 2));
    await fs.rename(tmp, file);
    return true;
  } catch {
    return false;
  }
}

/** 读取后台配置的自定义代理（文件缺失/损坏返回空数组，不影响内置兜底） */
export async function readCustomMirrors(): Promise<string[]> {
  return (await readProxyStore()).mirrors;
}

/** 写入自定义代理（保留已设置的优先代理；代理被移除时一并清掉优先设置） */
export async function writeCustomMirrors(list: string[]): Promise<boolean> {
  const normalized = Array.from(
    new Set(list.map((m) => normalizeMirrorBase(m)).filter((m): m is string => Boolean(m)))
  );
  const prev = await readProxyStore();
  const preferred =
    prev.preferred && normalized.some((m) => sourceKey(m) === sourceKey(prev.preferred as string))
      ? prev.preferred
      : null;
  return writeProxyStore({ mirrors: normalized, preferred });
}

/** 读取后台指定的优先代理（null = 未指定，按全源竞速） */
export async function readProxyPreference(): Promise<string | null> {
  return (await readProxyStore()).preferred;
}

/**
 * 设置优先代理：传 base 指定，传 null 清除（恢复自动竞速）。
 * 非法值直接忽略并清除，避免把坏地址写进配置。
 */
export async function writeProxyPreference(base: string | null): Promise<boolean> {
  const store = await readProxyStore();
  const next = base ? normalizeMirrorBase(base) : null;
  // 只有确实在候选列表里的地址才允许被设为优先，防止写入失效地址后版本检测反复空跑
  const allowed = next ? (await listProxySources()).some((s) => sourceKey(s.base) === sourceKey(next)) : false;
  return writeProxyStore({ mirrors: store.mirrors, preferred: allowed ? next : null });
}

/**
 * 由候选源 base 拼接 GH 最新 release 端点。
 * 官方源直接加路径；代理镜像的 base 需自带上游完整地址，例如：
 *   https://gh-proxy.com/https://api.github.com/  →  https://gh-proxy.com/https://api.github.com/repos/OWNER/REPO/releases/latest
 */
function releaseUrl(base: string): string {
  return `${base}repos/${GITHUB_REPO}/releases/latest`;
}

/** 去重用的归一化键：忽略结尾斜杠差异（https://api.github.com 与 https://api.github.com/ 是同一源） */
function sourceKey(base: string): string {
  return base.replace(/\/+$/, "");
}

/**
 * 全部候选源（官方居首，去重）。所有源始终参与检测，不做测速裁减——
 * 避免出网波动时误删可用的代理；后台自定义的代理排在最后并优先生效于同名的内置项。
 */
export async function listProxySources(): Promise<ProxySource[]> {
  const { bases, scope } = configuredMirrors();
  const [custom, preferred] = await Promise.all([readCustomMirrors(), readProxyPreference()]);
  const sources: ProxySource[] = [{ base: OFFICIAL_BASE, scope: "official" }];
  const seen = new Set<string>([sourceKey(OFFICIAL_BASE)]);
  for (const base of bases) {
    if (seen.has(sourceKey(base))) continue;
    seen.add(sourceKey(base));
    sources.push({ base, scope });
  }
  for (const base of custom) {
    if (seen.has(sourceKey(base))) continue; // 与内置/官方重复时保留前者，避免同一源被请求两次
    seen.add(sourceKey(base));
    sources.push({ base, scope: "custom" });
  }
  const preferredKey = preferred ? sourceKey(preferred) : "";
  // 只在确实为优先源时附加标记，避免给每个源都塞一个 preferred: false（既有断言更干净）
  return sources.map((s) =>
    preferredKey && sourceKey(s.base) === preferredKey ? { ...s, preferred: true } : s
  );
}

async function candidateSources(): Promise<string[]> {
  return (await listProxySources()).map((s) => s.base);
}

/** 单个源的单次连通性测试结果（后台「测试连通性」用） */
export interface ProxyTestResult {
  base: string;
  scope: ProxyScope;
  label: string;
  ok: boolean;
  ms: number;
  status?: number;
  reason: string;
}

/** 测试全部候选源的连通性（并发；官方用更短超时，其余放宽） */
export async function testProxySources(): Promise<ProxyTestResult[]> {
  const sources = await listProxySources();
  return Promise.all(
    sources.map(async (s, i) => {
      const t0 = Date.now();
      const r = await probe(s.base, i === 0 ? OFFICIAL_TIMEOUT_MS : MIRROR_TIMEOUT_MS);
      const ms = Date.now() - t0;
      return {
        base: s.base,
        scope: s.scope,
        label: i === 0 ? "api.github.com（官方）" : mirrorLabel(s.base),
        ok: r.kind === "ok",
        ms,
        status: r.kind === "http" ? r.status : undefined,
        reason: describeResult(r),
      };
    })
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapRelease(raw: Record<string, unknown>): ReleaseInfo {
  const tag = String(raw.tag_name ?? "");
  return {
    tag,
    version: normalizeVersion(tag),
    name: String(raw.name ?? tag),
    body: String(raw.body ?? ""),
    htmlUrl: String(raw.html_url ?? ""),
    publishedAt: String(raw.published_at ?? ""),
  };
}

export interface FetchLatestResult {
  data: ReleaseInfo | null;
  fromCache: boolean;
  error?: string;
}

/**
 * 获取 GitHub 最新 release：所有候选源并发竞速，取最快成功；一轮全部失败则短暂间隔后整体重试一轮，
 * 以此抵御服务器出网间歇性丢包（同一源往往 1-2 次内即恢复）。任何时刻都保留全部源，不做测速裁减。
 * 成功结果带 10 分钟内存缓存，错误结果仅缓存 30 秒（允许快速自愈）；force=true 绕过进程级缓存。
 * 全部源均失败才返回 { data:null, error }（已映射为友好中文提示），不抛异常。
 */

type ProbeResult =
  | { kind: "ok"; data: ReleaseInfo }
  | { kind: "http"; status: number }
  | { kind: "timeout" }
  | { kind: "net" }
  | { kind: "noRelease" };

const TIMEOUT_RE = /timeout|aborted/i;

/** 单源单次探测：成功返回 release，否则返回定性错误（不做重试，重试在轮次层统一处理） */
async function probe(base: string, timeoutMs: number): Promise<ProbeResult> {
  try {
    const res = await fetch(releaseUrl(base), {
      headers: RELEASE_HEADERS,
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (res.ok) {
      try {
        return { kind: "ok", data: mapRelease((await res.json()) as Record<string, unknown>) };
      } catch {
        return { kind: "net" }; // 响应体解析失败
      }
    }
    // 没有有效状态码：按连接失败处理，避免把「根本没连上」报成某个 HTTP 状态
    if (!res.status) return { kind: "net" };
    return { kind: "http", status: res.status };
  } catch (e) {
    const timeout =
      e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError" || TIMEOUT_RE.test(e.message));
    return { kind: timeout ? "timeout" : "net" };
  }
}

/**
 * 汇总一轮全部失败结果，定性最贴切的失败原因。
 * 官方源（results[0]）的失败原因最贴近真实状况 —— 镜像的 4xx/5xx 往往只是代理自身的问题，
 * 用它去解释失败会把「官方被限流 403」误报成「网络错误」，或反过来掩盖真因。
 */
function classify(results: ProbeResult[]): ProbeResult {
  if (results.some((r) => r.kind === "noRelease" || (r.kind === "http" && r.status === 404))) {
    return { kind: "noRelease" };
  }
  const official = results[0];
  if (official && official.kind !== "ok") return official;
  if (results.some((r) => r.kind === "timeout")) return { kind: "timeout" };
  if (results.some((r) => r.kind === "net")) return { kind: "net" };
  const http = results.find((r) => r.kind === "http");
  return http ?? { kind: "net" };
}

/** 失败原因的可读描述（仅用于服务端日志，便于事后定位） */
function describeResult(r: ProbeResult): string {
  switch (r.kind) {
    case "ok":
      return "成功";
    case "http":
      return `HTTP ${r.status}`;
    case "timeout":
      return "超时";
    case "net":
      return "连接失败";
    default:
      return "无 release";
  }
}

/** 一轮竞速：并发探测全部候选源，首个成功即返回（快源无需等慢源），全失败则汇总定性原因 */
async function raceOnce(sources: string[], round: number): Promise<ProbeResult> {
  return new Promise<ProbeResult>((resolve) => {
    let settled = false;
    let failed = 0;
    const results = new Array<ProbeResult>(sources.length);
    sources.forEach((base, i) => {
      // 官方源用更短超时、镜像放宽：首元素约定为官方（classify 依赖该顺序）
      probe(base, i === 0 ? OFFICIAL_TIMEOUT_MS : MIRROR_TIMEOUT_MS).then((r) => {
        if (settled) return;
        if (r.kind === "ok") {
          settled = true;
          resolve(r);
          return;
        }
        results[i] = r;
        failed++;
        if (failed === sources.length) {
          settled = true;
          // 出网异常是线上排查的常见盲区：把每个源的真实结果写进容器日志，
          // 便于事后区分「官方被限流 403」/「出网超时」/「镜像自身故障」，而不是只有一句「网络错误」
          console.warn(
            `[version] 第 ${round} 轮全部源失败：` +
              sources
                .map((s, idx) => `${safeHost(s)}=${describeResult(results[idx])}`)
                .join("，")
          );
          resolve(classify(results));
        }
      });
    });
  });
}

/** 取源的 host 用于日志（镜像 base 是「代理 + 上游完整地址」，取到的即代理域名） */
function safeHost(base: string): string {
  try {
    return new URL(base).host;
  } catch {
    return base;
  }
}

export async function fetchLatestRelease(force = false): Promise<FetchLatestResult> {
  // 每次查询前自动清理过期缓存，防止热更新环境下长期运行后缓存与实际不符
  clearGlobalCache();

  // 版本缓存为权威来源：新鲜即直接采用（并回写进程级缓存，避免后续反复读盘）；
  // 文件过期则保留为"末级兜底"，网络竞速全失败时降级返回过期数据，避免 UI 显示"未知"。
  let staleHost: VersionCacheDoc | null = null;
  if (!force) {
    const host = await readVersionCache();
    if (host) {
      const fresh = Date.now() - host.timestamp < VERSION_CACHE_TTL_MS;
      if (fresh) {
        globalCache.latest = { at: Date.now(), data: host.data, error: host.error };
        return { data: host.data, fromCache: true, error: host.error };
      }
      staleHost = host;
    }
  }

  const cached = globalCache.latest;
  if (cached) {
    const isError = cached.error !== undefined;
    const ttl = isError ? ERROR_CACHE_TTL_MS : CACHE_TTL_MS;
    if (!force && Date.now() - cached.at < ttl) {
      return { data: cached.data, fromCache: true, error: cached.error };
    }
  }

  const sources = await candidateSources();
  let last: ProbeResult | undefined;

  // 后台指定的优先代理：先单独探它一次，成功就直接采用（不再等其他源）。
  // 用途：官方源在部分网络下长期超时而某个代理稳定可用时，可在后台「测试连通性」
  // 后把它设为优先，版本检测就固定走它。
  const preferred = await readProxyPreference();
  if (preferred && sources.includes(preferred)) {
    const r = await probe(preferred, MIRROR_TIMEOUT_MS);
    if (r.kind === "ok") {
      globalCache.latest = { at: Date.now(), data: r.data };
      return { data: r.data, fromCache: false };
    }
    if (r.kind === "noRelease") {
      const message = "暂无已发布的版本";
      globalCache.latest = { at: Date.now(), data: null, error: message };
      return { data: null, fromCache: false, error: message };
    }
    // 优先代理不可用：记录后继续走全源竞速，不让单点故障卡死版本检测
    console.warn(`[version] 优先代理 ${safeHost(preferred)} 不可用（${describeResult(r)}），回退全源竞速`);
  }

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await raceOnce(sources, round + 1);
    if (res.kind === "ok") {
      globalCache.latest = { at: Date.now(), data: res.data };
      return { data: res.data, fromCache: false };
    }
    if (res.kind === "noRelease") {
      const message = "暂无已发布的版本";
      globalCache.latest = { at: Date.now(), data: null, error: message };
      return { data: null, fromCache: false, error: message };
    }
    last = res;
    if (round < MAX_ROUNDS - 1) await sleep(ROUND_GAP_MS);
  }

  // 网络全失败：优先降级到宿主机缓存的过期版本数据，其次复用其错误/失败说明
  if (staleHost?.data) {
    globalCache.latest = { at: Date.now(), data: staleHost.data };
    return { data: staleHost.data, fromCache: true };
  }
  const message =
    last?.kind === "timeout"
      ? "检测最新版本超时，请稍后重试"
      : last?.kind === "http"
        ? `GitHub 接口返回 ${last.status}${last.status === 403 ? "（可能触发限流，请稍后重试）" : ""}`
        : "网络错误，获取最新版本失败，请重试";
  if (staleHost?.error) {
    globalCache.latest = { at: Date.now(), data: null, error: staleHost.error };
    return { data: null, fromCache: true, error: staleHost.error };
  }
  globalCache.latest = { at: Date.now(), data: null, error: message };
  return { data: null, fromCache: false, error: message };
}

/* ---------------- 版本缓存：按需刷新 / 写入（容器侧） ---------------- */

/** 登录触发刷新的去重窗口：5 分钟内重复登录不重复拉取，避免短时间内多次请求 GitHub */
const LOGIN_REFRESH_DEDUP_MS = 5 * 60 * 1000;

/** 登录触发：带短时去重的按需刷新（fire-and-forget，内部自消化错误） */
export async function refreshVersionCacheOnLogin(): Promise<void> {
  try {
    await refreshVersionCache({ dedupMs: LOGIN_REFRESH_DEDUP_MS });
  } catch {
    // 刷新失败（出网异常/写盘失败）仅影响版本提示，绝不影响登录流程
  }
}

/**
 * 按需刷新版本缓存：
 * - force=true：无视去重与缓存新鲜度，立即从 GitHub 拉取并写盘（"点击检测更新"入口）。
 * - 否则：上次刷新距今 < dedupMs 则跳过（"登录后台"入口用，重复登录不重复拉）。
 * 拉取失败时保留既有缓存文件（不写坏数据），并返回错误说明供 UI 提示。
 */
export async function refreshVersionCache(
  opts: { force?: boolean; dedupMs?: number } = {}
): Promise<{ refreshed: boolean; data: ReleaseInfo | null; error?: string }> {
  const cached = await readVersionCache();
  const now = Date.now();
  if (!opts.force && cached && now - cached.timestamp < (opts.dedupMs ?? 0)) {
    return { refreshed: false, data: cached.data, error: cached.error };
  }

  const res = await fetchLatestRelease(true); // force：绕过进程级缓存，直连 GitHub
  if (res.data) {
    await writeVersionCache({
      timestamp: Date.now(),
      data: res.data,
    });
    return { refreshed: true, data: res.data };
  }
  // 拉取失败：保留原有缓存，返回错误，避免用失败态覆盖良好缓存
  return { refreshed: false, data: cached?.data ?? null, error: res.error || cached?.error };
}

/** 原子写入版本缓存；目录缺失自动创建。容器对缓存目录无写权限时静默失败（不影响读旧缓存） */
async function writeVersionCache(doc: { timestamp: number; data: ReleaseInfo | null; error?: string }): Promise<boolean> {
  try {
    const file = versionCacheFile();
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(doc, null, 2));
    await fs.rename(tmp, file);
    return true;
  } catch {
    return false;
  }
}

/**
 * 读取宿主机缓存里的最新 release（不看新鲜度）。
 *
 * 用途：强制刷新失败（出网抖动/限流）时的降级来源 —— 触发更新只需要一个有效的目标 tag，
 * 用缓存里的上次成功结果即可继续，不必因为一次检测失败就把用户卡在「无法检测到最新版本」。
 */
export async function readCachedRelease(): Promise<ReleaseInfo | null> {
  return (await readVersionCache())?.data ?? null;
}

/** 供测试清空缓存，保证隔离 */
export function resetReleaseCache(): void {
  delete globalCache.latest;
}