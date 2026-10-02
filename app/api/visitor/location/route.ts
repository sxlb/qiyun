import { NextResponse, NextRequest } from "next/server";
import { getClientIp } from "@/lib/server";
import { lookupIpRegion, type RegionInfo } from "@/lib/geo";

export const dynamic = "force-dynamic";

/** 访客地域展示标签：国内 → 省+市（"广东省 深圳市"，去掉冗余的"中国"前缀）；
 *  海外 → 国家（"日本"）。内网/未知 → 空串（前端不展示地域）。 */
function visitorRegion(info: RegionInfo): string {
  if (info.internal) return "";
  const isChina = info.country === "中国" || info.country === "中国香港" || info.country === "中国澳门" || info.country === "中国台湾";
  if (isChina) return [info.province, info.city].filter(Boolean).join(" ");
  return info.country || info.province || info.city || "";
}

/**
 * 访客地域信息（公开，无需登录）。
 * 供欢迎弹窗展示"来自 X·Y"；复用后端已内置的 ip2region 离线库解析客户端 IP，
 * 替代此前前端直连第三方接口（对外部服务的可用性/隐私/时延无依赖）。
 * 只返回给浏览者自己所在的地域标签，不涉及统计，无越权隐患。
 */
export async function GET(request: NextRequest) {
  try {
    const region = visitorRegion(lookupIpRegion(getClientIp(request)));
    return NextResponse.json({ region });
  } catch (e) {
    console.error("[GET /api/visitor/location] 解析失败:", e);
    return NextResponse.json({ region: "" });
  }
}