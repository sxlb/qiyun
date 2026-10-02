import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { internalError, error, requireSession } from "@/lib/server";

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

interface GeoPoint {
  region: string;
  visits: number;
  /** 去重后的独立访客数（按 IP 哈希去重） */
  ips: number;
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireSession();
    if (!session) return error("未授权", 401);

    // 范围过滤：?days=30 表示最近 30 天（含今天），缺省为全部
    const days = Number(request.nextUrl.searchParams.get("days") || 0);
    const since = rangeFromDays(days);
    const dateWhere = since ? { date: { gte: since } } : {};

    // 【VULN-04】记录在上报时已把地域解析为标签并按 IP 哈希去重，
    // 这里直接按 (region, ipHash) 分组：同一 region 下每个 ipHash 即 1 个独立访客，
    // 全程无需接触任何 IP 明文。
    const regionGroups = await prisma.visitRecord.groupBy({
      by: ["region", "ipHash"],
      where: { ...dateWhere, region: { not: "" } },
      _count: { _all: true },
      orderBy: { _count: { region: "desc" } },
      take: 5000,
    });

    const byRegion = new Map<string, GeoPoint>();
    const bump = (key: string, visits: number, ips: number) => {
      const prev = byRegion.get(key);
      if (prev) {
        prev.visits += visits;
        prev.ips += ips;
      } else {
        byRegion.set(key, { region: key, visits, ips });
      }
    };
    for (const g of regionGroups) bump(g.region, g._count._all, 1);

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

    return NextResponse.json({
      list,
      totalVisits,
      sampled: regionGroups.length,
    });
  } catch (e) {
    return internalError("[GET /api/stats/geo] 查询失败", e);
  }
}
