import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { internalError, error, requireSession } from "@/lib/server";
import { lookupIpRegion } from "@/lib/geo";

export const dynamic = "force-dynamic";

/** 若提供 range（days），返回该天数前的东八区日期字符串；否则 null（不限） */
function rangeFromDays(days: number): string | null {
  if (!Number.isFinite(days) || days <= 0) return null;
  const dt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  dt.setUTCDate(dt.getUTCDate() - days);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** IP → 统计地域键：内网归"局域网/未知"；国内归省级；海外归国家 */
function regionKey(ip: string): string {
  const info = lookupIpRegion(ip);
  if (info.internal) return "局域网/未知";
  if (info.country === "中国") return info.province || "中国（未知）";
  return info.country || "未知";
}

interface GeoPoint {
  region: string;
  visits: number;
  /** 命中去重后的独立 IP 数（可反映用户规模） */
  ips: number;
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireSession();
    if (!session) return error("未授权", 401);

    // 范围过滤：?days=30 表示最近 30 天（含今天），缺省为全部
    const days = Number(request.nextUrl.searchParams.get("days") || 0);
    const since = rangeFromDays(days);

    // 按 IP 分组统计，取最活跃的 500 个 IP 解析地域（个人站量级：覆盖绝大多数访问且解析开销可控）
    const groups = await prisma.visitRecord.groupBy({
      by: ["ip"],
      where: since ? { date: { gte: since } } : undefined,
      _count: { _all: true },
      orderBy: { _count: { ip: "desc" } },
      take: 500,
    });

    const byRegion = new Map<string, GeoPoint>();
    for (const g of groups) {
      const key = regionKey(g.ip);
      const visits = g._count._all;
      const prev = byRegion.get(key);
      if (prev) {
        prev.visits += visits;
        prev.ips += 1;
      } else {
        byRegion.set(key, { region: key, visits, ips: 1 });
      }
    }

    const list: GeoPoint[] = [...byRegion.values()].sort((a, b) => b.visits - a.visits);
    const totalVisits = list.reduce((s, p) => s + p.visits, 0);

    // 导出模式：返回 CSV 文本（含 UTF-8 BOM，Excel 打开不乱码）。
    // 地域字段用双引号包裹并对内嵌引号转义，防止含逗号/引号的地域名破坏列结构
    const wantCsv = request.nextUrl.searchParams.get("export") === "csv";
    if (wantCsv) {
      const csv = (v: string) => `"${v.replace(/"/g, '""')}"`;
      const rows = [
        ["地域", "访问次数", "独立IP数", "占比"].join(","),
        ...list.map((p) => [csv(p.region), p.visits, p.ips, `${((p.visits / (totalVisits || 1)) * 100).toFixed(1)}%`].join(",")),
      ];
      return new NextResponse("\uFEFF" + rows.join("\n"), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="visit-geo-${Date.now()}.csv"`,
        },
      });
    }

    return NextResponse.json({ list, totalVisits, sampled: groups.length });
  } catch (e) {
    return internalError("[GET /api/stats/geo] 查询失败", e);
  }
}