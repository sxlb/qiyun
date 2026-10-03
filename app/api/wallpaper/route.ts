import { NextRequest, NextResponse } from "next/server";
import {
  cacheTagFor,
  getRandomCachedWallpaper,
  downloadAndCacheWallpaper,
  maybePrefetchWallpaper,
  replaceWallpaper,
} from "@/lib/wallpaperCache";
import { prisma } from "@/lib/db";
import { error, getClientIp, isRateLimited } from "@/lib/server";
import {
  normalizeWallpaperDevice,
  resolveExternalApi,
  resolveWallpaperApi,
  pickExternalApis,
  type ExternalApiConfig,
  type WallpaperDevice,
} from "@/lib/external-api";

export const dynamic = "force-dynamic";

/** 后台可配的缓存刷新间隔（分钟）：0=不刷新 / 5 / 10 / 30 */
const REFRESH_VALUES = [0, 5, 10, 30];

/** 手动换图的 IP 限流：公开端点，允许它直接打上游就必须限速 */
const FORCE_RATE_MAX = 6;
const FORCE_RATE_WINDOW_MS = 60_000;

interface BingResponse {
  images?: Array<{ url?: string }>;
}

/**
 * 解析壁纸源的真实图片直链（服务端执行，供缓存服务下载）。
 * bing / landscape / anime；custom 由 bgApi 直连返回，不进入缓存，此处返回 null。
 *
 * 风景与动漫按设备取源：手机取竖图地址、电脑取横图地址（见 resolveWallpaperApi）；
 * 必应每日只有一张，不区分横竖，两个设备共用。
 *
 * 上游地址均取自后台「外部服务」配置：这些免费图床历史上失效过（原 vvhan 壁纸源已下线），
 * 配置化后可在后台直接换源，无需改代码重新部署。
 */
async function resolveSourceUrl(
  coverType: string,
  apis: ExternalApiConfig,
  device: WallpaperDevice
): Promise<string | null> {
  if (coverType === "custom") return null; // 自定义源由 bgApi 直连，不缓存/下载
  if (coverType === "landscape") return resolveWallpaperApi(apis, "landscape", device);
  if (coverType === "anime") return resolveWallpaperApi(apis, "anime", device);
  // 默认：必应每日壁纸
  const endpoint = resolveExternalApi(apis, "bingWallpaperApi");
  const res = await fetch(endpoint, {
    next: { revalidate: 3600 },
    // 【High 修复】强制 10s 超时，防止第三方接口挂住 Next.js event loop
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`壁纸接口 HTTP ${res.status}`);
  const data = (await res.json()) as BingResponse;
  const url = data.images?.[0]?.url;
  if (!url) throw new Error("壁纸接口未返回图片");
  // 相对路径以「已配置的接口地址」为基准补全主机名：换用镜像后不再硬拼 bing.com
  return new URL(url, endpoint).toString();
}

/**
 * GET /api/wallpaper?coverType=&bgApi=&refresh=&device=&force=&t=
 *
 * 默认行为（缓存优先）：返回本地缓存里的壁纸地址；该分池为空时才即时下载一张。
 * 缓存充足时**不会**为了取图去请求上游（只有后台按刷新间隔静默补图）。
 *
 * force=1 是「手动换一张」：明确去上游取一张新的并写入缓存；该预算组已满 100 张时
 * 替换掉最旧的一张。必应当天只有一张图，换了也是同一张，因此只对随机源
 * （风景 / 动漫）生效 —— 前端右键菜单也是按同一条件决定是否展示这一项的。
 *
 * device：pc（默认）/ mobile，决定取竖图还是横图，同时决定读写哪个缓存分池。
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const coverType = sp.get("coverType") || "bing";
  const bgApi = sp.get("bgApi") || "";
  // 设备维度：只有明确传 mobile 才按手机处理，其余（缺失 / 非法）回落到 pc，与分流前行为一致
  const device = normalizeWallpaperDevice(sp.get("device"));
  const tag = cacheTagFor(coverType, device);
  // 缓存刷新间隔：0=不刷新 / 5 / 10 / 30 分钟（非法值按不刷新处理）
  const refreshRaw = Number(sp.get("refresh") || 0);
  const refresh = REFRESH_VALUES.includes(refreshRaw) ? refreshRaw : 0;
  // 手动换图：必应（每日只有一张）与自定义直链都不适用
  const force =
    sp.get("force") === "1" && (coverType === "landscape" || coverType === "anime");

  // 手动换图会直接打上游：公开端点必须按 IP 限速，否则等于开放了一个刷上游的接口
  if (
    force &&
    isRateLimited(`wallpaper-force:${getClientIp(request) || "unknown"}`, FORCE_RATE_MAX, FORCE_RATE_WINDOW_MS)
  ) {
    return error("换图过于频繁，请稍后再试", 429);
  }

  // 自定义壁纸：用户自己的直链，无需缓存，直接返回
  const custom = bgApi.trim();
  if (custom) {
    return NextResponse.json({ url: custom, cached: false });
  }

  try {
    // 读取外部服务配置（查询失败时回退内置默认地址，保证壁纸可用性）
    const profile = await prisma.profile.findFirst({ orderBy: { id: "asc" } }).catch(() => null);
    const sourceUrl = await resolveSourceUrl(coverType, pickExternalApis(profile), device);
    if (!sourceUrl) {
      // coverType=custom 但未提供 bgApi：无可用的自定义直链
      return NextResponse.json({ url: "", cached: false });
    }

    if (force) {
      const fileName = await replaceWallpaper(sourceUrl, tag);
      if (fileName) {
        return NextResponse.json({
          url: `/api/wallpaper/file/${fileName}`,
          cached: true,
          switched: true,
        });
      }
      // 换图失败（上游不可达等）：返回空 url，前端保留当前壁纸，不要退化成兜底图
      return NextResponse.json({ url: "", cached: false, error: "未取到新的壁纸，请稍后再试" });
    }

    const cached = await getRandomCachedWallpaper(tag);
    if (cached) {
      // 已命中缓存：后台按间隔静默预取轮换，不阻塞本次响应
      maybePrefetchWallpaper(sourceUrl, refresh, tag).catch(() => {
        /* 预取失败静默，下次请求自动重试 */
      });
      return NextResponse.json({ url: `/api/wallpaper/file/${cached}`, cached: true });
    }

    // 缓存为空（该分池首次访问）：即时下载一张
    const fileName = await downloadAndCacheWallpaper(sourceUrl, tag);
    if (fileName) {
      return NextResponse.json({ url: `/api/wallpaper/file/${fileName}`, cached: true });
    }
  } catch (e) {
    if (process.env.NODE_ENV === "development") console.warn("[GET /api/wallpaper]", e);
  }

  // 全部失败：返回空，前端直连兜底（原逻辑）
  return NextResponse.json({ url: "", cached: false });
}
