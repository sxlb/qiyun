import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, error } from "@/lib/server";

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
      const text = await res.text();
      try {
        body = text ? JSON.parse(text) : undefined;
      } catch {
        body = undefined;
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

  // 读取 Profile 配置（高德 Key / 腾讯城市），用于条件探测
  let amapKey = "";
  let weatherCity = "";
  try {
    const profile = await prisma.profile.findFirst({ orderBy: { id: "asc" } });
    amapKey = profile?.amapKey || "";
    weatherCity = profile?.weatherCity || "";
  } catch {
    /* 数据库异常时跳过条件探测 */
  }

  const probes: Promise<ServiceStatus>[] = [
    probe("bing", "必应每日壁纸", "默认壁纸源", "https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1"),
    probe("xxapi", "XXAPI 服务", "随机头像 / 一言(renjian) / 天气翻译", "https://v2.xxapi.cn/api/head?return=json"),
    probe("hitokoto", "一言 Hitokoto", "一言主数据源", "https://v1.hitokoto.cn/?encode=json"),
    probe("vvhan", "VVHAN 接口", "随机壁纸 / 一言备用源", "https://api.vvhan.com/api/hitokoto"),
  ];

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
