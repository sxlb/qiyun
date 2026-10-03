import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, error } from "@/lib/server";
import { fillTemplate, joinUrl, pickExternalApis, resolveExternalApi } from "@/lib/external-api";

export const dynamic = "force-dynamic";

// 探测结果缓存：避免频繁刷新触发大量外部请求（30 秒）
const CACHE_TTL_MS = 30_000;
const PROBE_TIMEOUT_MS = 4000;

let cache: { at: number; services: ServiceStatus[] } | null = null;

interface ServiceStatus {
  id: string;
  name: string;
  desc: string;
  url: string;
  status: "ok" | "fail" | "skip";
  latency: number;
  error?: string;
}

/** 执行一次带超时与耗时统计的请求，返回 HTTP 状态 */
async function probeFetch(
  url: string,
  method: "GET" | "HEAD" = "GET"
): Promise<{ ok: boolean; latency: number; status: number; body?: unknown }> {
  const start = performance.now();
  try {
    const res = await fetch(url, {
      method,
      cache: "no-store",
      // 模拟浏览器 UA：部分免费上游（如 VVHAN）会拒绝无 UA 的请求
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "Accept-Language": "zh-CN,zh;q=0.9",
      },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const latency = Math.round(performance.now() - start);
    let body: unknown;
    if (res.ok) {
      const contentType = res.headers.get("content-type") || "";
      // 仅 JSON 响应读取 body（目前只有高德需要校验业务码 status）。
      // 壁纸 / 随机图探测命中的是数 MB 的原图，整张读进内存既浪费带宽，
      // 也容易在 4s 超时窗口内读不完，把本来可用的图床误判成「连接失败或超时」。
      if (/json/i.test(contentType)) {
        const text = await res.text();
        try {
          body = text ? JSON.parse(text) : undefined;
        } catch {
          body = undefined;
        }
      } else {
        // 非 JSON（图片 / 二进制）：立即释放响应体，只保留「能否拿到响应」的结论
        await res.body?.cancel().catch(() => {
          /* 取消失败不影响探测结论 */
        });
      }
    }
    return { ok: res.ok, latency, status: res.status, body };
  } catch {
    return { ok: false, latency: Math.round(performance.now() - start), status: 0 };
  }
}

/** 单次探测 → 状态结果（统一 try/catch 防单点失败） */
async function probe(id: string, name: string, desc: string, url: string, method: "GET" | "HEAD" = "GET"): Promise<ServiceStatus> {
  const result = await probeFetch(url, method);
  const status: ServiceStatus = {
    id,
    name,
    desc,
    url,
    status: result.ok ? "ok" : "fail",
    latency: result.latency,
    error: result.ok ? undefined : result.status ? `HTTP ${result.status}` : "连接失败或超时",
  };
  return status;
}

/** 高德探测：需校验业务返回 status==="1"（HTTP 恒为 200） */
async function probeAmap(amapKey: string, city: string): Promise<ServiceStatus> {
  const searchParams = new URLSearchParams({ key: amapKey, city: city || "210000", extensions: "base" });
  const target = `https://restapi.amap.com/v3/weather/weatherInfo?${searchParams.toString()}`;
  const result = await probeFetch(target);
  const bizOk = result.body && typeof result.body === "object" && (result.body as { status?: string }).status === "1";
  // 展示用 URL 剥离 key 参数，避免高德签名 Key 随健康响应明文下发/在页面展示
  const displayUrl = `https://restapi.amap.com/v3/weather/weatherInfo?city=${encodeURIComponent(city || "210000")}&extensions=base`;
  return {
    id: "amap",
    name: "高德地图天气",
    desc: "需在天气设置中配置 Key",
    url: displayUrl,
    status: result.ok && bizOk ? "ok" : "fail",
    latency: result.latency,
    error: result.ok && !bizOk ? "Key 无效或权限不足" : result.status ? `HTTP ${result.status}` : "连接失败或超时",
  };
}

/**
 * 外部上游服务健康探测
 * - 仅管理员可访问（避免被外部滥用触发大量出站请求）
 * - 结果缓存 30 秒，?force=1 强制刷新
 * - 全部并行探测，单服务失败不影响其他
 */
export async function GET(request: NextRequest) {
  const session = await requireSession();
  if (!session) return error("未授权", 401);

  const force = request.nextUrl.searchParams.get("force") === "1";
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return NextResponse.json({ checkedAt: cache.at, cached: true, services: cache.services });
  }

  // 读取 Profile 配置：外部服务地址（探测清单来源）+ 高德 Key / 腾讯城市（条件探测）。
  // 数据库异常时回退 null —— 全部按内置默认地址探测，不影响健康检查可用性。
  const profile = await prisma.profile.findFirst({ orderBy: { id: "asc" } }).catch(() => null);
  const amapKey = profile?.amapKey || "";
  const weatherCity = profile?.weatherCity || "";

  // 探测清单的地址一律取自后台「外部服务」配置（未配置则用内置默认），
  // 保证「面板显示的地址」与「实际请求的地址」始终一致。
  // 注：一言已改为内置本地语句库（不再请求外部接口），故原先的 hitokoto / vvhan 探测项已移除。
  const apis = pickExternalApis(profile);
  const probes: Promise<ServiceStatus>[] = [
    probe("bing", "必应每日壁纸", "默认壁纸源（不区分横竖，手机与电脑共用）", resolveExternalApi(apis, "bingWallpaperApi")),
    probe("landscape", "随机风景壁纸（电脑）", "壁纸种类=随机风景时使用：电脑端取横图", resolveExternalApi(apis, "wallpaperLandscapeApi")),
    probe("landscape-mobile", "随机风景壁纸（手机）", "壁纸种类=随机风景时使用：手机端取竖图", resolveExternalApi(apis, "wallpaperLandscapeApiMobile")),
    probe("anime", "随机动漫壁纸（电脑）", "壁纸种类=随机动漫时使用：电脑端取横图", resolveExternalApi(apis, "wallpaperAnimeApi")),
    probe("anime-mobile", "随机动漫壁纸（手机）", "壁纸种类=随机动漫时使用：手机端取竖图", resolveExternalApi(apis, "wallpaperAnimeApiMobile")),
    probe("avatar", "随机头像服务", "开启随机头像时使用", resolveExternalApi(apis, "randomAvatarApi")),
    probe(
      "iconify",
      "Iconify 图标",
      "在线图标（后台图标浏览器与前台图标渲染）",
      joinUrl(resolveExternalApi(apis, "iconifyApi"), "collection?prefix=fa6-solid")
    ),
  ];

  // 自定义 favicon 服务：默认留空表示不启用（仅用内置多源），故只在配置后才探测
  const faviconTemplate = (apis.faviconApi ?? "").trim();
  if (faviconTemplate) {
    probes.push(
      probe(
        "favicon",
        "favicon 服务",
        "后台「从网站获取」图标的优先源",
        fillTemplate(faviconTemplate, { host: "github.com" })
      )
    );
  }

  // 条件探测：仅当后台已配置对应项
  if (amapKey) {
    probes.push(probeAmap(amapKey, weatherCity));
  }
  if (weatherCity) {
    probes.push(
      probe("tencent", "腾讯天气", "需在天气设置中填写城市", `https://wis.qq.com/city/like?source=pc&city=${encodeURIComponent(weatherCity)}`)
    );
  }

  const results = await Promise.allSettled(probes);
  const services = results.map((r) => (r.status === "fulfilled" ? r.value : null)).filter((s): s is ServiceStatus => s !== null);

  cache = { at: Date.now(), services };
  return NextResponse.json({ checkedAt: cache.at, cached: false, services });
}
