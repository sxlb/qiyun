import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { error, getClientIp, internalError, readTextWithLimit, requireSession } from "@/lib/server";
import { isRateLimited } from "@/lib/rate-limit";
import { fetchFollowingSafeRedirects, UnsafeUrlError } from "@/lib/ssrf";
import { joinUrl, pickExternalApis, resolveExternalApi } from "@/lib/external-api";

export const dynamic = "force-dynamic";

/**
 * Iconify 图标集目录接口（供后台 IconifyPicker 浏览任意图标集）
 *
 * 设计要点：
 * - 只返回「图标名 + 分类」，不返回 SVG 图形（图形由前端按页批量向 Iconify JSON API 拉取），
 *   故响应体积可控（千级图标约数十 KB）；
 * - prefix 会拼进上游 URL，必须严格校验为 iconify 图标集标识（小写字母/数字/连字符），
 *   杜绝路径穿越与参数注入；
 * - 仅管理员可调用：本接口会发起服务端出站请求，对外开放等于提供匿名探活能力；
 * - 出站走 lib/ssrf 的逐跳校验，防止被当作内网探测跳板；
 * - 按账号限流，进程内按 prefix 缓存 1 小时，避免频繁打上游。
 */

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 小时
/** 缓存条目上限：图标集数量有限，20 个足以覆盖常用集，防止无界增长 */
const CACHE_MAX_ENTRIES = 20;
/** 上游请求超时 */
const FETCH_TIMEOUT_MS = 8000;
/** 上游目录响应体上限：常见图标集在 2MB 内，8MB 足够覆盖且能挡住异常膨胀 */
const MAX_CATALOG_BYTES = 8 * 1024 * 1024;

/** 上游目录响应体超限：单独一个类型，便于给出明确提示而不是笼统的 500 */
class CatalogTooLargeError extends Error {}

/** iconify 图标集标识：小写字母/数字，连字符分隔（如 fa6-solid、simple-icons） */
const PREFIX_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PREFIX_MAX_LEN = 40;

interface IconEntry {
  name: string;
  category?: string;
}

interface CategoryStat {
  name: string;
  count: number;
}

interface IconCatalogPayload {
  prefix: string;
  title: string;
  total: number;
  categories: CategoryStat[];
  icons: IconEntry[];
}

/** Iconify /collection 响应结构（仅取用到的字段） */
interface CollectionData {
  prefix?: string;
  title?: string;
  categories?: Record<string, string[]>;
  uncategorized?: string[];
  hidden?: string[];
}

/** 进程内缓存（按 prefix 分键，带 TTL 与条目上限） */
const cache = new Map<string, { at: number; payload: IconCatalogPayload }>();

/** 写入缓存并在超限时驱逐最老条目（Map 保持插入顺序，首个即最老） */
function setCache(prefix: string, payload: IconCatalogPayload): void {
  if (cache.size >= CACHE_MAX_ENTRIES && !cache.has(prefix)) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(prefix, { at: Date.now(), payload });
}

/** 拉取图标集并转换为扁平列表（同名前缀内去重） */
function collect(data: CollectionData): IconEntry[] {
  const out: IconEntry[] = [];
  const seen = new Set<string>();

  const push = (name: string, category?: string) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    out.push(category ? { name, category } : { name });
  };

  data.uncategorized?.forEach((name) => push(name));
  if (data.categories) {
    for (const [category, names] of Object.entries(data.categories)) {
      names.forEach((name) => push(name, category));
    }
  }
  data.hidden?.forEach((name) => push(name));

  return out;
}

/**
 * 获取指定图标集的目录（带进程内缓存）。
 * 失败时抛出，由调用方映射为中文提示 —— 与「静默返回空列表」相比，
 * 管理员能直接看到是网络问题还是图标集名写错。
 */
async function fetchCatalog(prefix: string): Promise<IconCatalogPayload> {
  const cached = cache.get(prefix);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.payload;

  const profile = await prisma.profile.findFirst({ orderBy: { id: "asc" } }).catch(() => null);
  const base = joinUrl(resolveExternalApi(pickExternalApis(profile), "iconifyApi"), "collection");

  const { response } = await fetchFollowingSafeRedirects(`${base}?prefix=${encodeURIComponent(prefix)}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });

  if (!response.ok) throw new Error(`上游返回 HTTP ${response.status}`);

  // 上游目录属于外部输入：边读边计数、超过上限立即终止流，
  // 避免异常响应把整个响应体读进内存（原先直接 response.json() 没有上限）
  const read = await readTextWithLimit(response, MAX_CATALOG_BYTES);
  if (!read.ok) throw new CatalogTooLargeError("上游目录响应体超过大小限制");

  const data = JSON.parse(read.text) as CollectionData;
  const icons = collect(data);

  const counts = new Map<string, number>();
  for (const icon of icons) {
    const key = icon.category ?? "未分类";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const categories: CategoryStat[] = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const payload: IconCatalogPayload = {
    prefix,
    title: data.title || prefix,
    total: icons.length,
    categories,
    icons,
  };
  setCache(prefix, payload);
  return payload;
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireSession();
    if (!session) return error("未授权", 401);

    const rateKey = `icon-catalog:${session.user?.name || getClientIp(request)}`;
    if (isRateLimited(rateKey, 30)) return error("请求过于频繁，请稍后再试", 429);

    const prefix = (request.nextUrl.searchParams.get("prefix") || "").trim().toLowerCase();
    if (!prefix) return error("缺少 prefix 参数");
    if (prefix.length > PREFIX_MAX_LEN || !PREFIX_RE.test(prefix)) {
      return error("图标集标识格式不合法");
    }

    const payload = await fetchCatalog(prefix);
    return NextResponse.json(payload);
  } catch (e) {
    if (e instanceof CatalogTooLargeError) {
      return error("图标集目录响应体过大，已拒绝");
    }
    if (e instanceof UnsafeUrlError) {
      return error(`图标集接口地址不合法：${e.message}`);
    }
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
      return error("图标集加载超时，请检查网络或「外部服务」中的 Iconify 地址");
    }
    return internalError("[GET /api/icons] 获取图标集失败", e);
  }
}
