import { NextResponse, NextRequest } from "next/server";
import { extractHostname, probeFavicon } from "@/lib/favicon";
import { error, internalError, requireSession } from "@/lib/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/favicon?url=<网址或域名>
 * 后台「从网站获取」：探测并返回首个真实可用的网站图标地址。
 * 返回 { ok: true, host, url, source }；探测失败返回 { ok: false, host, error }。
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireSession();
    if (!session) {
      return error("未授权", 401);
    }

    const input = request.nextUrl.searchParams.get("url") || "";
    const host = extractHostname(input);
    if (!host) {
      return error("无法识别域名，请填写完整网址（如 https://github.com/sxlb）");
    }

    const hit = await probeFavicon(host);
    if (!hit) {
      return NextResponse.json({
        ok: false,
        host,
        error: `未探测到 ${host} 的可用图标（域名无法解析，或站点未提供 favicon）`,
      });
    }

    return NextResponse.json({ ok: true, host, url: hit.url, source: hit.source });
  } catch (e) {
    return internalError("[GET /api/favicon] 探测失败", e);
  }
}
