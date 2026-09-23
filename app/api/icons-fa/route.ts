import { NextResponse } from "next/server";

/**
 * FontAwesome 图标清单接口（供后台 FaIconPicker 使用）
 * - 代理 Iconify /collection API，取回 fa6-solid + fa6-brands 的全部免费图标「名称」（不含 SVG 图形）
 * - 图形由前端按页批量向 Iconify JSON API 拉取，故此处响应体积很小（约 95KB）
 * - 进程内内存缓存 1 小时，避免频繁请求外部接口
 */

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 小时

type FaPrefix = "fa6-solid" | "fa6-brands";

interface FaIconOption {
  name: string;
  category?: string;
  prefix: FaPrefix;
}

interface FaCategoryStat {
  name: string;
  count: number;
}

interface FaIconsPayload {
  icons: FaIconOption[];
  categories: FaCategoryStat[];
}

/** Iconify /collection 响应结构（仅取用到的字段） */
interface CollectionData {
  categories?: Record<string, string[]>;
  uncategorized?: string[];
  hidden?: string[];
}

/** 进程内缓存 */
let cachedData: FaIconsPayload | null = null;
let cacheTime = 0;

const COLLECTION_URL = "https://api.iconify.design/collection";

/** 拉取单个图标集并转换为扁平列表（同名前缀内去重） */
function collect(data: CollectionData, prefix: FaPrefix, out: FaIconOption[]): void {
  const seen = new Set<string>();

  const push = (name: string, category?: string) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    out.push(category ? { name, category, prefix } : { name, prefix });
  };

  data.uncategorized?.forEach((name) => push(name));
  if (data.categories) {
    for (const [category, names] of Object.entries(data.categories)) {
      names.forEach((name) => push(name, category));
    }
  }
  data.hidden?.forEach((name) => push(name));
}

/** 获取图标清单（带内存缓存）；失败时返回空数据，不影响后台主流程 */
async function getIcons(): Promise<FaIconsPayload> {
  const now = Date.now();
  if (cachedData && now - cacheTime < CACHE_TTL_MS) return cachedData;

  try {
    const [solidRes, brandsRes] = await Promise.all([
      // revalidate: 让 Next 数据缓存复用外部响应，减少出网
      fetch(`${COLLECTION_URL}?prefix=fa6-solid`, { next: { revalidate: 3600 } }),
      fetch(`${COLLECTION_URL}?prefix=fa6-brands`, { next: { revalidate: 3600 } }),
    ]);

    if (!solidRes.ok || !brandsRes.ok) {
      throw new Error(`Iconify collection API 返回异常: ${solidRes.status} / ${brandsRes.status}`);
    }

    const solidData = (await solidRes.json()) as CollectionData;
    const brandsData = (await brandsRes.json()) as CollectionData;

    const icons: FaIconOption[] = [];
    collect(solidData, "fa6-solid", icons);
    collect(brandsData, "fa6-brands", icons);

    const counts = new Map<string, number>();
    for (const icon of icons) {
      const key = icon.category ?? "未分类";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const categories: FaCategoryStat[] = [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    const payload: FaIconsPayload = { icons, categories };
    cachedData = payload;
    cacheTime = now;
    return payload;
  } catch (err) {
    console.error("[API /api/icons-fa] 获取图标清单失败:", err);
    return { icons: [], categories: [] };
  }
}

export async function GET() {
  const payload = await getIcons();
  return NextResponse.json(payload);
}
