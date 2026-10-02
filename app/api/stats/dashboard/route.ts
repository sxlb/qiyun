import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, error, internalError } from "@/lib/server";
import { buildDailySeries, buildWeekHours, sourceBucket, SOURCE_BUCKET_LABEL, mondayOf, weekDelta, shiftDate, cnDateStr } from "@/lib/stats";

export const dynamic = "force-dynamic";

/** 访问统计看板：概要 + 30 天趋势 + 来源/设备/系统/浏览器/时段 + 热门链接 + 地域（仅后台管理员） */
export async function GET() {
  try {
    const session = await requireSession();
    if (!session) {
      return error("未授权", 401);
    }

    const today = cnDateStr();
    const yesterday = shiftDate(today, -1);
    const windowStart = shiftDate(today, -29);
    // 「当前在线」：最近 10 分钟内有访问的去重 IP 数
    const onlineSince = new Date(Date.now() - 10 * 60 * 1000);

    const [
      todayRow,
      yesterdayRow,
      all,
      recent,
      onlineRows,
      heatRows,
      referrers,
      devices,
      oss,
      browsers,
      hours,
      topLinks,
    ] = await Promise.all([
      prisma.visitStat.findUnique({ where: { date: today } }),
      prisma.visitStat.findUnique({ where: { date: yesterday } }),
      prisma.visitStat.aggregate({ _sum: { pv: true, uv: true } }),
      prisma.visitStat.findMany({
        where: { date: { gte: windowStart } },
        orderBy: { date: "asc" },
      }),
      // 当前在线：最近 10 分钟去重访客（按不可逆 IP 哈希，不接触明文）
      prisma.visitRecord.groupBy({
        by: ["ipHash"],
        where: { createdAt: { gte: onlineSince }, ipHash: { not: "" } },
        _count: { _all: true },
      }),
      // 一周时段热力图素材：近 28 天按 (date, hour) 分组，前端按星期归一
      prisma.visitRecord.groupBy({
        by: ["date", "hour"],
        where: { date: { gte: shiftDate(today, -27) } },
        _count: { _all: true },
      }),
      // 来源站（last 30 天，仅非空）
      prisma.visitRecord.groupBy({
        by: ["referrerDomain"],
        where: { date: { gte: windowStart }, referrerDomain: { not: "" } },
        _count: { _all: true },
        orderBy: { _count: { referrerDomain: "desc" } },
        take: 10,
      }),
      // 设备
      prisma.visitRecord.groupBy({
        by: ["device"],
        where: { date: { gte: windowStart } },
        _count: { _all: true },
        orderBy: { _count: { device: "desc" } },
      }),
      // 操作系统（Top 8，空归"未知"）
      prisma.visitRecord.groupBy({
        by: ["os"],
        where: { date: { gte: windowStart } },
        _count: { _all: true },
        orderBy: { _count: { os: "desc" } },
        take: 8,
      }),
      // 浏览器（Top 8）
      prisma.visitRecord.groupBy({
        by: ["browser"],
        where: { date: { gte: windowStart } },
        _count: { _all: true },
        orderBy: { _count: { browser: "desc" } },
        take: 8,
      }),
      // 24 小时时段分布
      prisma.visitRecord.groupBy({
        by: ["hour"],
        where: { date: { gte: windowStart } },
        _count: { _all: true },
        orderBy: { hour: "asc" },
      }),
      // 热门链接（点击量 Top 8）
      prisma.siteLinkClick.findMany({
        orderBy: { count: "desc" },
        take: 8,
      }),
    ]);

    const daily = buildDailySeries(
      recent.map((r) => ({ date: r.date, pv: r.pv, uv: r.uv })),
      30,
      today
    );

    // 一周时段热力图：7 行（周一~周日）× 24 列（0~23 时），取近 28 天累加
    const weekHours = buildWeekHours(
      heatRows.map((r) => ({ date: r.date, hour: r.hour, count: r._count._all }))
    );

    // 地域统计：上报时已把地域解析为标签落库 region，直接按 region 聚合即可（不接触明文 IP）
    const regionRows = await prisma.visitRecord.groupBy({
      by: ["region"],
      where: { date: { gte: windowStart }, region: { not: "" } },
      _count: { _all: true },
      orderBy: { _count: { region: "desc" } },
      take: 2000,
    });
    const geoAgg = new Map<string, number>();
    let unknown = 0;
    let geoTotal = 0;
    const addGeo = (label: string, count: number) => {
      geoTotal += count;
      if (label === "局域网/未知") {
        unknown += count;
        return;
      }
      geoAgg.set(label, (geoAgg.get(label) ?? 0) + count);
    };
    for (const row of regionRows) addGeo(row.region, row._count._all);
    const geo = {
      total: geoTotal,
      unknown,
      regions: [...geoAgg.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
    };

    // 来源构成：对窗口内全部 referrerDomain 分桶（直接 / 搜索 / 社交 / 外链）
    const srcRows = await prisma.visitRecord.groupBy({
      by: ["referrerDomain"],
      where: { date: { gte: windowStart } },
      _count: { _all: true },
      orderBy: { _count: { referrerDomain: "desc" } },
      take: 200,
    });
    const bucketCount: Record<keyof typeof SOURCE_BUCKET_LABEL, number> = { direct: 0, search: 0, social: 0, external: 0 };
    for (const row of srcRows) {
      bucketCount[sourceBucket(row.referrerDomain)] += row._count._all;
    }
    const sourceBuckets = (Object.keys(SOURCE_BUCKET_LABEL) as (keyof typeof SOURCE_BUCKET_LABEL)[]).map((k) => ({
      name: SOURCE_BUCKET_LABEL[k],
      count: bucketCount[k],
    }));

    // 本周 vs 上周对比（周一为一周起点；本周统计到今日，上周取完整 7 天）
    const curStart = mondayOf(today);
    const prevStart = shiftDate(curStart, -7);
    const prevEnd = shiftDate(curStart, -1);
    const [curAgg, prevAgg] = await Promise.all([
      prisma.visitStat.aggregate({
        _sum: { pv: true, uv: true },
        where: { date: { gte: curStart, lte: today } },
      }),
      prisma.visitStat.aggregate({
        _sum: { pv: true, uv: true },
        where: { date: { gte: prevStart, lte: prevEnd } },
      }),
    ]);
    const weekCompare = {
      curStart,
      curEnd: today,
      prevStart,
      prevEnd,
      curPv: curAgg._sum.pv ?? 0,
      curUv: curAgg._sum.uv ?? 0,
      prevPv: prevAgg._sum.pv ?? 0,
      prevUv: prevAgg._sum.uv ?? 0,
      pvDelta: weekDelta(curAgg._sum.pv ?? 0, prevAgg._sum.pv ?? 0),
      uvDelta: weekDelta(curAgg._sum.uv ?? 0, prevAgg._sum.uv ?? 0),
    };

    return NextResponse.json({
      totalPv: all._sum.pv ?? 0,
      totalUv: all._sum.uv ?? 0,
      todayPv: todayRow?.pv ?? 0,
      todayUv: todayRow?.uv ?? 0,
      yesterdayPv: yesterdayRow?.pv ?? 0,
      yesterdayUv: yesterdayRow?.uv ?? 0,
      daily,
      // 增强维度
      referrers: referrers.map((r) => ({ name: r.referrerDomain, count: r._count._all })),
      sourceBuckets,
      devices: devices.map((r) => ({ name: r.device, count: r._count._all })),
      os: oss.map((r) => ({ name: r.os || "未知", count: r._count._all })),
      browsers: browsers.map((r) => ({ name: r.browser || "未知", count: r._count._all })),
      hours: Array.from({ length: 24 }, (_, h) => {
        const row = hours.find((x) => x.hour === h);
        return { hour: h, count: row?._count._all ?? 0 };
      }),
      topLinks: topLinks.map((l) => ({ name: l.name, count: l.count, url: l.url })),
      geo,
      weekCompare,
      // 增强维度
      onlineNow: onlineRows.length, // 最近 10 分钟去重访客数（当前在线）
      weekHours, // 7(周一~周日) × 24 时段热力图
      windowStart,
    });
  } catch (e) {
    return internalError("[GET /api/stats/dashboard] 查询失败", e);
  }
}