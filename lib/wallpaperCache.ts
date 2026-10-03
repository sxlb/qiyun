import { promises as fs } from "node:fs";
import path from "node:path";
import { fetchFollowingSafeRedirects } from "@/lib/ssrf";
import { contentTypeFromExt, isSafeFileName, newFileName } from "@/lib/uploads";
import type { WallpaperDevice } from "@/lib/external-api";

/**
 * ===== 壁纸服务端缓存 =====
 *
 * 目的：壁纸源（必应 / MWM 图床）随时可能失效，将壁纸下载到服务器本地缓存，
 * 页面展示一律走本地文件，源 API 挂掉也不影响已有壁纸展示。
 *
 * 机制：
 * - 缓存目录：<cwd>/data/wallpapers（.gitignore 已排除 data/，Docker 卷映射目录）
 * - 上限：按「预算组」各 100 张 —— 电脑一组、手机一组、必应共享一组，合计最多 300 张。
 *   达到上限即**停止自动新增**，不再删旧图：旧图被自动删掉会让访客刚看惯的壁纸凭空消失。
 *   唯一会替换旧图的是后台/右键菜单里明确发起的「换一张壁纸」。
 * - 读取：一律优先本地缓存，只要本组有图就不为取图去请求上游。
 * - 填充：不足 READY_CACHE_SIZE（5 张）时尽快热身到 5 张；达到后按「刷新间隔」
 *   每次访问静默补 1 张，直到该组满 100 张为止。
 * - manifest.json 记录缓存清单（文件名/来源/时间/大小）与上次刷新时间
 * - 所有写操作串行化（内存队列），避免并发请求竞争写坏 manifest / 目录
 */

/** 单个缓存预算组的上限（张）：电脑 / 手机 / 必应共享 各 100 */
export const MAX_BUDGET_SIZE = 100;
/**
 * 本地缓存「够用」的张数阈值。
 * 低于它时不等刷新间隔、尽快热身（否则后台刷新间隔默认为 0 时永远只有 1 张图，
 * 而 1 张图谈不上「优先从缓存读取」）；达到它之后就只读本地，交给刷新间隔慢慢攒。
 */
export const READY_CACHE_SIZE = 5;
/** 单张图片大小上限（字节）：20MB */
const MAX_FILE_SIZE = 20 * 1024 * 1024;
/** 下载超时（ms） */
const DOWNLOAD_TIMEOUT = 15_000;
/** 相邻两次下载的最小间隔（ms）：防止短时间连续请求壁纸源被屏蔽 */
const MIN_DOWNLOAD_GAP_MS = 5_000;

/** 壁纸缓存目录 */
function getWallpaperCacheDir(): string {
  return path.join(process.cwd(), "data", "wallpapers");
}

/** manifest 文件名：既是指引清单，也是「扫描目录清空」时必须显式跳过的那个文件 */
const MANIFEST_NAME = "manifest.json";

const MANIFEST_FILE = () => path.join(getWallpaperCacheDir(), MANIFEST_NAME);

/**
 * 缓存分池标签。
 *
 * 必须同时带上「壁纸源」与「设备」两个维度：
 * - 只按设备切池是不够的 —— 风景端的手机默认值仍是横图源（上游没有竖版风景），
 *   若与动漫端共用一个池，手机选「动漫」时仍可能抽到那张横图，等于没做到"手机只加载手机壁纸"；
 * - 与设备无关的源（必应每日壁纸）用 `shared`，手机与电脑共用一池，同一张图不必存两份。
 */
export type WallpaperCacheTag = "shared" | `landscape:${WallpaperDevice}` | `anime:${WallpaperDevice}`;

/** 参与分池的壁纸源（其余种类一律走 shared） */
const POOLED_SOURCES = ["landscape", "anime"] as const;

/**
 * 由壁纸种类与设备推导缓存分池标签。
 * 风景 / 动漫按「源 + 设备」分池，互不串图；必应、自定义等与设备无关的源共用一个池。
 */
export function cacheTagFor(coverType: string, device: WallpaperDevice): WallpaperCacheTag {
  const source = POOLED_SOURCES.find((s) => s === coverType);
  // 这里的断言是安全的：POOLED_SOURCES 的取值恰好能拼出上方的联合类型
  return source ? (`${source}:${device}` as WallpaperCacheTag) : "shared";
}

interface CacheEntry {
  fileName: string;
  sourceUrl: string;
  addedAt: number;
  size: number;
  /** 分池标签；升级前的历史条目没有该字段（无从判断来源与横竖，只允许被 shared 复用） */
  tag?: WallpaperCacheTag;
}

interface Manifest {
  entries: CacheEntry[];
  lastRefreshAt: number | null;
  /** 上次下载/尝试时刻（用于节流，持久化避免重启后突发请求） */
  lastDownloadAt: number | null;
}

/**
 * 缓存预算组：上限既不看分池总数、也不看全局总数，而是按「谁在用」分组。
 *
 * - `pc`     电脑：风景:pc + 动漫:pc
 * - `mobile` 手机：风景:mobile + 动漫:mobile
 * - `shared` 必应这类与设备无关的源（含升级前没有标签的历史条目）
 *
 * 这样「手机别占电脑的额度」才成立：手机池攒满了也不会挤掉电脑的图。
 */
export type WallpaperCacheBudget = "pc" | "mobile" | "shared";

/** 预算组的中文名（后台用量展示用） */
export const CACHE_BUDGET_LABELS: Record<WallpaperCacheBudget, string> = {
  pc: "电脑",
  mobile: "手机",
  shared: "必应共享",
};

/** 后台展示用的预算组顺序 */
export const CACHE_BUDGETS: WallpaperCacheBudget[] = ["pc", "mobile", "shared"];

/**
 * 分池标签 → 预算组。
 * 升级前的历史条目没有标签，只有 `shared` 允许复用它们，因此一律计入 `shared`。
 */
export function cacheBudgetFor(tag: WallpaperCacheTag | null | undefined): WallpaperCacheBudget {
  if (tag === "landscape:pc" || tag === "anime:pc") return "pc";
  if (tag === "landscape:mobile" || tag === "anime:mobile") return "mobile";
  return "shared";
}

/** 统计某个预算组已有的条目数 */
function countInBudget(entries: CacheEntry[], budget: WallpaperCacheBudget): number {
  return entries.filter((entry) => cacheBudgetFor(entry.tag) === budget).length;
}

/** 空清单工厂：每次返回新对象，避免共享引用被并发操作污染 */
function emptyManifest(): Manifest {
  return { entries: [], lastRefreshAt: null, lastDownloadAt: null };
}

/** 串行化写操作的执行队列（模块级单例，单进程内有效） */
let writeQueue: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(fn, fn);
  writeQueue = run.catch(() => {
    /* 错误由调用方处理，队列继续 */
  });
  return run;
}

/** 确保缓存目录存在 */
async function ensureCacheDir(): Promise<void> {
  await fs.mkdir(getWallpaperCacheDir(), { recursive: true });
}

/**
 * 校验 manifest 里的单个条目。
 *
 * manifest 是磁盘上的普通 JSON 文件，可能被人工编辑、被外部清理工具改写过。
 * 结构上无法使用的条目（null / 字符串 / 缺 fileName）必须在这里丢掉：
 * 否则它会带着 undefined 一路传到接口层，在读取 entry.size / entry.fileName 时抛
 * TypeError，让「查看缓存列表」「删除一张」这类操作整个变成 500。
 *
 * 注意只丢弃**结构非法**的条目；文件名不安全的条目保留下来（列表会标记 exists:false），
 * 让后台能看到并把它删掉，而不是让它变成一个看不见又删不掉的幽灵记录。
 */
function sanitizeEntry(value: unknown): CacheEntry | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<CacheEntry>;
  if (typeof raw.fileName !== "string" || raw.fileName === "") return null;
  return {
    fileName: raw.fileName,
    sourceUrl: typeof raw.sourceUrl === "string" ? raw.sourceUrl : "",
    addedAt: typeof raw.addedAt === "number" && Number.isFinite(raw.addedAt) ? raw.addedAt : 0,
    size: typeof raw.size === "number" && Number.isFinite(raw.size) && raw.size >= 0 ? raw.size : 0,
    tag: typeof raw.tag === "string" ? (raw.tag as WallpaperCacheTag) : undefined,
  };
}

/** 读取 manifest；不存在/损坏时返回空清单 */
async function loadManifest(): Promise<Manifest> {
  try {
    const raw = await fs.readFile(MANIFEST_FILE(), "utf8");
    const parsed = JSON.parse(raw) as Partial<Manifest>;
    if (!Array.isArray(parsed.entries)) return emptyManifest();
    return {
      entries: parsed.entries
        .map(sanitizeEntry)
        .filter((entry): entry is CacheEntry => entry !== null),
      lastRefreshAt: typeof parsed.lastRefreshAt === "number" ? parsed.lastRefreshAt : null,
      lastDownloadAt: typeof parsed.lastDownloadAt === "number" ? parsed.lastDownloadAt : null,
    };
  } catch {
    return emptyManifest();
  }
}

/**
 * 保存 manifest。
 *
 * 用「临时文件 + rename」原子替换，而不是直接覆盖写：writeFile 会先截断再写，
 * 恰好在那一瞬间读到该文件的请求会拿到空内容或半截 JSON，被 loadManifest 当成
 * 「清单为空」—— 前台表现为重复下载一张壁纸，后台表现为「已缓存 0 张」。
 * 同目录 rename 在 POSIX 上是原子的，读方要么看到旧内容、要么看到新内容。
 */
async function saveManifest(manifest: Manifest): Promise<void> {
  await ensureCacheDir();
  const target = MANIFEST_FILE();
  const tmp = `${target}.tmp`;
  const json = JSON.stringify(manifest);
  await fs.writeFile(tmp, json, "utf8");
  try {
    await fs.rename(tmp, target);
  } catch {
    // 少数平台（如 Windows 上目标被外部句柄短暂占用）rename 会失败：
    // 退回直接覆盖写 —— 宁可短暂失去原子性，也不能把这次索引更新整个丢掉
    await fs.writeFile(target, json, "utf8");
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
}

/** Content-Type → 文件扩展名；非图片返回空 */
function extFromContentType(contentType: string): string {
  const mime = contentType.split(";")[0].trim().toLowerCase();
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/avif": ".avif",
    "image/bmp": ".bmp",
  };
  // 不映射 image/svg+xml：SVG 可内嵌脚本，存在存储型 XSS 风险，一律拒绝
  return map[mime] || "";
}

/** 按文件头（Magic Number）识别图片类型；非受支持的光栅图返回 null */
function extFromMagicNumber(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return ".jpg";
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return ".png";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).equals(Buffer.from("RIFF")) &&
    buffer.subarray(8, 12).equals(Buffer.from("WEBP"))
  ) {
    return ".webp";
  }
  if (buffer.length >= 6 && buffer.subarray(0, 4).equals(Buffer.from("GIF8"))) return ".gif";
  if (
    buffer.length >= 12 &&
    buffer.subarray(4, 8).equals(Buffer.from("ftyp")) &&
    (buffer.subarray(8, 12).equals(Buffer.from("avif")) ||
      buffer.subarray(8, 12).equals(Buffer.from("avis")))
  ) {
    return ".avif";
  }
  if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) return ".bmp";
  return null;
}

/** 下载图片（SSRF 逐跳校验 + 超时 + 类型/大小校验），失败抛错 */
async function downloadImage(sourceUrl: string): Promise<{ buffer: Buffer; ext: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT);
  try {
    // 必须走逐跳校验的封装，不能用 fetch 的 redirect: "follow"：
    // 壁纸源一旦（被攻陷或作恶）302 到内网 / 云元数据地址，follow 会跳过校验直接请求，
    // 且响应体会作为「壁纸」写入本地并可被读取 —— 构成把内网内容外带的 SSRF 通道。
    const { response: res } = await fetchFollowingSafeRedirects(sourceUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; homepage-bot/1.0)" },
    });
    if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
    const ext = extFromContentType(res.headers.get("content-type") || "");
    if (!ext) throw new Error(`非图片响应：${res.headers.get("content-type") || "unknown"}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength === 0) throw new Error("图片内容为空");
    if (buffer.byteLength > MAX_FILE_SIZE) throw new Error("图片超过 20MB 限制");
    // 以实际文件头为准校验，防止内容与声明类型不符（如伪装成 jpg 的 SVG）
    if (extFromMagicNumber(buffer) !== ext) {
      throw new Error(`文件头与声明类型不符，已拒绝：${ext}`);
    }
    return { buffer, ext };
  } finally {
    clearTimeout(timer);
  }
}

/** 加入缓存的方式 */
type AddMode =
  /** 自动填充：该组满了直接跳过，不删任何旧图 */
  | "fill"
  /** 手动换图：满了就替换本组最旧的一张（否则满仓之后就没有「不满意换一张」的出口），且不受下载间隔限制 */
  | "manual";

/**
 * 下载并加入缓存（必须在 enqueue 内调用，保证写操作串行）。
 * 返回文件名；跳过或失败返回 null。
 *
 * 节流：自动填充时相邻两次下载/尝试至少间隔 MIN_DOWNLOAD_GAP_MS，
 * 防止短时间连续请求壁纸源被屏蔽；失败也会记录尝试时刻，重试同样有间隔。
 * 手动换图跳过这个间隔 —— 那是用户明确点的动作，上游保护交给接口层按 IP 限流
 * （见 app/api/wallpaper/route.ts 的 force 分支）。
 */
async function addWallpaperLocked(
  sourceUrl: string,
  manifest: Manifest,
  now: number,
  tag: WallpaperCacheTag,
  mode: AddMode = "fill"
): Promise<string | null> {
  const manual = mode === "manual";
  const budget = cacheBudgetFor(tag);
  const full = countInBudget(manifest.entries, budget) >= MAX_BUDGET_SIZE;
  // 满仓：自动填充到此为止（「到一百就停止」）；只有手动换图才继续，走替换最旧的逻辑
  if (full && !manual) return null;

  // 距离上次下载/尝试不足 5s：自动填充跳过本次（返回 null，前端继续用现有缓存）
  if (
    !manual &&
    manifest.lastDownloadAt !== null &&
    now - manifest.lastDownloadAt < MIN_DOWNLOAD_GAP_MS
  ) {
    return null;
  }
  // 记录尝试时刻（成功/失败都持久化）
  manifest.lastDownloadAt = now;

  try {
    const { buffer, ext } = await downloadImage(sourceUrl);
    const fileName = newFileName(ext);
    await ensureCacheDir();
    await fs.writeFile(path.join(getWallpaperCacheDir(), fileName), buffer);

    // 满仓下的手动换图：先挤掉本组最旧的一张，保证总数不越过上限
    if (full) {
      const oldest = manifest.entries
        .filter((entry) => cacheBudgetFor(entry.tag) === budget)
        .reduce<CacheEntry | null>(
          (min, entry) => (min === null || entry.addedAt < min.addedAt ? entry : min),
          null
        );
      if (oldest) {
        const idx = manifest.entries.indexOf(oldest);
        if (idx >= 0) manifest.entries.splice(idx, 1);
        await fs
          .rm(path.join(getWallpaperCacheDir(), oldest.fileName), { force: true })
          .catch(() => {
            /* 删除失败不影响主流程 */
          });
      }
    }

    manifest.entries.push({ fileName, sourceUrl, addedAt: now, size: buffer.byteLength, tag });
    manifest.lastRefreshAt = now;

    await saveManifest(manifest);
    return fileName;
  } catch {
    // 下载/写入失败：不更新 lastRefreshAt（下次到期自动重试），
    // 但持久化 lastDownloadAt 节流标记，保证重试也有间隔
    await saveManifest(manifest).catch(() => {
      /* 保存失败静默 */
    });
    return null;
  }
}

/**
 * 从缓存随机取一张壁纸；该分池为空返回 null。
 * 读取不经过写队列（允许读到稍旧的 manifest，可接受）。
 *
 * 分流规则：
 * - 优先取标签完全相同的条目；
 * - 标签为 `shared`（必应这类与设备无关的源）时，允许复用升级前的无标签历史条目；
 * - 标签为 `源:设备` 且本池为空时**不**回退 —— 历史条目到底是什么来源、横竖已无从判断，
 *   宁可让前端重新下载一张，也不冒险把电脑横图塞给手机（这正是本次要修的问题）。
 */
export async function getRandomCachedWallpaper(tag: WallpaperCacheTag): Promise<string | null> {
  try {
    const manifest = await loadManifest();
    if (manifest.entries.length === 0) return null;
    const sameTag = manifest.entries.filter((e) => e.tag === tag);
    const candidates =
      sameTag.length > 0
        ? sameTag
        : tag === "shared"
          ? manifest.entries.filter((e) => !e.tag)
          : [];
    if (candidates.length === 0) return null;
    const idx = Math.floor(Math.random() * candidates.length);
    return candidates[idx].fileName;
  } catch {
    return null;
  }
}

/**
 * 下载一张壁纸并加入缓存（缓存为空时的首次填充）。
 * 成功返回文件名；该组已满或下载失败返回 null。
 */
export function downloadAndCacheWallpaper(
  sourceUrl: string,
  tag: WallpaperCacheTag
): Promise<string | null> {
  return enqueue(async () => {
    const manifest = await loadManifest();
    return addWallpaperLocked(sourceUrl, manifest, Date.now(), tag);
  });
}

/**
 * 手动「换一张壁纸」：明确去上游取一张新的。
 *
 * 与自动填充的关键区别：该组已满 100 张时也照做 —— 替换掉本组最旧的那张，总数保持不变。
 * 否则「缓存满了就停止新增」会把「不满意就换一张」这条出口一起堵死。
 * 同时不受 MIN_DOWNLOAD_GAP_MS 限制（用户明确点的动作），上游保护由接口层按 IP 限流负责。
 */
export function replaceWallpaper(
  sourceUrl: string,
  tag: WallpaperCacheTag
): Promise<string | null> {
  return enqueue(async () => {
    const manifest = await loadManifest();
    return addWallpaperLocked(sourceUrl, manifest, Date.now(), tag, "manual");
  });
}

/**
 * 按刷新间隔后台预取：到期时下载一张新壁纸入缓存，否则跳过。
 * intervalMin：0 表示不按间隔刷新；5 / 10 / 30 分钟。
 * 全程静默，失败不影响响应（下次请求自动重试）。
 *
 * 两条补充规则：
 * - 本组已满 MAX_BUDGET_SIZE 张：直接返回，不再新增（「到一百就停止」）。
 * - 本组不足 READY_CACHE_SIZE 张：**不受刷新间隔约束**，尽快热身到 5 张。
 *   否则后台间隔默认为 0（不刷新）时永远只有 1 张图，「优先从缓存读取」就名存实亡。
 *   热身同样受 MIN_DOWNLOAD_GAP_MS 约束，不会瞬间连打上游。
 *
 * 注意：节流窗口（`lastRefreshAt` / `lastDownloadAt`）是**全局共享**的，不按设备分开。
 * 这是刻意的取舍：小机器上"每个间隔只新增一张图"比"每台设备各新增一张"更省上游配额，
 * 代价是手机与电脑交替触发轮换、各自的刷新频率减半。
 */
export function maybePrefetchWallpaper(
  sourceUrl: string,
  intervalMin: number,
  tag: WallpaperCacheTag
): Promise<void> {
  return enqueue(async () => {
    const manifest = await loadManifest();
    const now = Date.now();
    const used = countInBudget(manifest.entries, cacheBudgetFor(tag));
    // 该组已满：停止自动新增（到一百就停止）
    if (used >= MAX_BUDGET_SIZE) return;

    // 「够用」阈值以内先热身：不等间隔，尽快让本地缓存具备可读性
    const warming = used < READY_CACHE_SIZE;
    // intervalMin = 0 表示「不按间隔刷新」：此时只有热身会补图，稳态不再增长
    const due =
      intervalMin > 0 &&
      (manifest.lastRefreshAt === null || now - manifest.lastRefreshAt >= intervalMin * 60_000);
    if (!due && !warming) return;

    await addWallpaperLocked(sourceUrl, manifest, now, tag);
  });
}

/**
 * 读取本地缓存图片。文件名不合法 / 不存在返回 null。
 */
export async function readCachedWallpaper(
  fileName: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  // 白名单字符 + 禁止目录穿越（".." / "."）
  if (!isSafeFileName(fileName)) return null;
  const filePath = path.join(getWallpaperCacheDir(), fileName);
  // 双重保险：确保解析结果仍位于缓存目录内（防路径穿越）
  if (!filePath.startsWith(getWallpaperCacheDir() + path.sep)) return null;
  try {
    const buffer = await fs.readFile(filePath);
    return { buffer, contentType: contentTypeFromExt(fileName) };
  } catch {
    return null;
  }
}

// ===== 以下导出来自 wallpaperServer.ts（已合并） =====

/**
 * SSR 阶段解析壁纸直链（仅走快速路径，绝不阻塞首屏渲染）：
 * - 自定义直链：直接返回
 * - 已有缓存：从对应分池随机返回一张本地缓存壁纸
 * - 无缓存：返回空串，由前端 /api/wallpaper 触发首次下载
 *
 * tag 决定从哪个分池取（见 getRandomCachedWallpaper）：必应这类与设备无关的源传 "shared"。
 * 不做网络请求（不解析壁纸源、不下载），仅做一次本地文件清单读取，
 * 因此即使在 ISR/SSR 流程中执行也足够快。
 */
export async function resolveWallpaperUrl(
  bgApi: string,
  tag: WallpaperCacheTag
): Promise<string> {
  const custom = bgApi.trim();
  if (custom) return custom;
  try {
    const cached = await getRandomCachedWallpaper(tag);
    return cached ? `/api/wallpaper/file/${cached}` : "";
  } catch {
    return "";
  }
}

/* ==================== 缓存管理（后台「壁纸缓存」分区） ==================== */

/**
 * 供后台展示的缓存条目。
 *
 * 之所以不把缓存登记进 `ImageAsset`（媒体库那张表）：缓存条数受预算上限约束（见 MAX_BUDGET_SIZE），
 * 与媒体库里用户内容的生命周期不同 —— 登记进库迟早留下「记录还在、文件已被删」的死链接。
 * 因此这里只做「读清单 + 删文件」，数据库完全不参与。
 */
export interface CachedWallpaper {
  fileName: string;
  /** 前台可直接使用的地址 */
  url: string;
  /** 上游来源地址，便于判断这张图是从哪个源抓到的 */
  sourceUrl: string;
  addedAt: number;
  /** 实际磁盘占用（以文件为准，manifest 里的值可能过期） */
  size: number;
  /** 分池标签；升级前的历史条目为 null */
  tag: WallpaperCacheTag | null;
  /** 文件是否真的还在磁盘上（manifest 与目录可能因外部操作不同步） */
  exists: boolean;
}

/** 单个预算组的用量（后台按「电脑 / 手机 / 必应共享」分别展示） */
export interface WallpaperCacheBudgetUsage {
  key: WallpaperCacheBudget;
  label: string;
  /** 该组已缓存的张数 */
  count: number;
  /** 该组的上限（张） */
  max: number;
  /** 该组实际占用字节（只算文件确实存在的条目） */
  bytes: number;
}

export interface WallpaperCacheOverview {
  items: CachedWallpaper[];
  total: number;
  /** 实际占用字节数（只统计文件确实存在的条目） */
  bytes: number;
  /** 单个预算组的上限（张）：电脑 / 手机 / 必应共享 各一份额度 */
  max: number;
  /** 本地缓存「够用」阈值（张）：达到后只读本地，不再为取图请求上游 */
  readyThreshold: number;
  /** 按预算组拆分的用量 */
  budgets: WallpaperCacheBudgetUsage[];
}

/**
 * 列出缓存内容（新到旧）。
 * 以 manifest 为准，但大小与存在性一律以磁盘实际状态为准：manifest 只是索引，
 * 目录才是事实源，两者可能因为外部操作（手工删文件、磁盘清理）不同步。
 */
export async function listCachedWallpapers(): Promise<WallpaperCacheOverview> {
  const manifest = await loadManifest();
  const dir = getWallpaperCacheDir();

  const items = await Promise.all(
    manifest.entries.map(async (entry): Promise<CachedWallpaper> => {
      let size = entry.size;
      let exists = false;
      // 文件名来自 manifest，理论上可信，但仍按白名单校验一次，避免被篡改后穿越目录
      if (isSafeFileName(entry.fileName)) {
        try {
          const st = await fs.stat(path.join(dir, entry.fileName));
          size = st.size;
          exists = true;
        } catch {
          exists = false;
        }
      }
      return {
        fileName: entry.fileName,
        url: `/api/wallpaper/file/${entry.fileName}`,
        sourceUrl: entry.sourceUrl,
        addedAt: entry.addedAt,
        size,
        tag: entry.tag ?? null,
        exists,
      };
    })
  );

  items.sort((a, b) => b.addedAt - a.addedAt);
  // 按预算组分别统计：后台要能一眼看出「手机池有没有占掉电脑的额度」
  const budgets = CACHE_BUDGETS.map((key) => {
    const group = items.filter((item) => cacheBudgetFor(item.tag) === key);
    return {
      key,
      label: CACHE_BUDGET_LABELS[key],
      count: group.length,
      max: MAX_BUDGET_SIZE,
      bytes: group.reduce((sum, item) => sum + (item.exists ? item.size : 0), 0),
    };
  });
  return {
    items,
    total: items.length,
    bytes: items.reduce((sum, i) => sum + (i.exists ? i.size : 0), 0),
    max: MAX_BUDGET_SIZE,
    readyThreshold: READY_CACHE_SIZE,
    budgets,
  };
}

/**
 * 删除一张缓存（清单 + 文件）。走写队列，避免与下载/裁剪并发写坏 manifest。
 * 返回是否命中了一条记录。
 */
export async function deleteCachedWallpaper(fileName: string): Promise<boolean> {
  if (!isSafeFileName(fileName)) return false;
  return enqueue(async () => {
    const manifest = await loadManifest();
    const idx = manifest.entries.findIndex((e) => e.fileName === fileName);
    if (idx === -1) return false;
    // 先改清单再删文件，与媒体库删除同一个顺序：清单是索引，先让它不再指向该文件，
    // 中途失败最多留个无人引用的孤儿文件，而不会留下「有记录没文件」的死链接
    manifest.entries.splice(idx, 1);
    await saveManifest(manifest);
    await fs.rm(path.join(getWallpaperCacheDir(), fileName), { force: true }).catch(() => {});
    return true;
  });
}

/**
 * 清空整个缓存并重置刷新时间戳。
 *
 * 时间戳一并清掉是有意义的：`lastRefreshAt` 归零后，下一次访问就会重新预取一张新壁纸，
 * 用户点完「清空」不会看到首页长时间没有背景。
 * 返回实际删除的条目数。
 */
export async function clearWallpaperCache(): Promise<number> {
  return enqueue(async () => {
    const dir = getWallpaperCacheDir();
    // 以**目录**为准，而不是以清单为准：清单一旦损坏或被手工改成空清单，
    // 磁盘上的图片就成了无人认领的孤儿 —— 只看 entries 会出现
    // 「点了清空、空间却没释放」，而且这些孤儿也不会被上限裁剪统计到。
    let names: string[] = [];
    try {
      names = (await fs.readdir(dir)).filter(
        (name) => name !== MANIFEST_NAME && isSafeFileName(name)
      );
    } catch {
      // 目录还不存在：视为没有缓存
      names = [];
    }
    // 先删文件、再写空清单：反过来的话，删除中途抛错会把索引先丢掉，
    // 而文件还在 —— 那才是真的全成了孤儿，比留下一条记录更糟
    await Promise.all(
      names.map((name) => fs.rm(path.join(dir, name), { force: true }).catch(() => {}))
    );
    await saveManifest(emptyManifest());
    return names.length;
  });
}
