import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { internalError, isRateLimited, getClientIp, serialized } from "@/lib/server";
import { parseUserAgent, extractReferrerDomain, nowHour, isBotUserAgent } from "@/lib/stats";

export const dynamic = "force-dynamic";

// UV 去重 Cookie：服务端签发，客户端无法伪造"新访客"
const UV_COOKIE = "qiyun-uv";
const UV_COOKIE_MAX_AGE = 365 * 24 * 60 * 60; // 一年

/**
 * 当前日期（东八区 YYYY-MM-DD）。
 * 注意：Docker 容器时区默认为 UTC，直接取本地时间会导致东八区凌晨 0-8 点统计错天，
 * 因此显式按 UTC+8 计算（中国大陆无夏令时，固定偏移安全）。
 */
function todayStr(): string {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * 访问统计 API
 * - POST：记录一次访问。PV 每次 +1；UV 通过服务端 Cookie 判定是否新访客（+1），
 *   不再信任客户端上报的 isNewVisitor，防止脚本无限刷 UV
 * - GET：返回今日 PV/UV 与累计 PV/UV
 */
export async function GET() {
  try {
    const today = todayStr();
    const todayRow = await prisma.visitStat.findUnique({ where: { date: today } });
    const all = await prisma.visitStat.aggregate({
      _sum: { pv: true, uv: true },
    });
    return NextResponse.json({
      todayPv: todayRow?.pv ?? 0,
      todayUv: todayRow?.uv ?? 0,
      totalPv: all._sum.pv ?? 0,
      totalUv: all._sum.uv ?? 0,
    });
  } catch (e) {
    return internalError("[GET /api/stats] 查询失败", e);
  }
}

export async function POST(request: NextRequest) {
  try {
    // 防刷：按 IP 限流（默认每分钟最多 60 次上报，正常浏览远达不到）
    const ip = getClientIp(request) || "unknown";
    if (isRateLimited(`stats:${ip}`)) {
      return NextResponse.json({ ok: false, error: "请求过于频繁" }, { status: 429 });
    }

    const today = todayStr();

    // 爬虫 / 机器人 / 探针不计入统计：它们会污染 PV、UV、设备分布与地域分布，
    // 使后台数字与实际访客量系统性偏高。此处仍返回现有统计供前端正常展示。
    const ua = request.headers.get("user-agent") || "";
    const isBot = isBotUserAgent(ua);
    // 首次访问（无 Cookie）计为新访客，同时签发 UV Cookie；机器人不签发
    const isNew = !isBot && !request.cookies.get(UV_COOKIE);

    if (!isBot) {
      // 汇总计数 + 明细写入均放入串行队列：SQLite 单写者限制下，
      // 同一进程并发写会触发 SQLITE_BUSY，串行后从根源消除写竞争
      await serialized(async () => {
        // 汇总计数（PV + 新访客则 UV+1）
        await prisma.visitStat.upsert({
          where: { date: today },
          update: { pv: { increment: 1 }, ...(isNew ? { uv: { increment: 1 } } : {}) },
          create: { date: today, pv: 1, uv: isNew ? 1 : 0 },
        });

        // 明细记录：来源域名 + 设备/系统/浏览器 + 时段，供统计增强看板聚合（失败不影响主统计）
        try {
          const { device, os, browser } = parseUserAgent(ua);
          await prisma.visitRecord.create({
            data: {
              date: today,
              hour: nowHour(),
              ip,
              referrerDomain: extractReferrerDomain(request.headers.get("referer") || ""),
              device,
              os,
              browser,
            },
          });
        } catch (e) {
          console.error("[POST /api/stats] 记录访问明细失败:", e);
        }
      });
    }

    // 上报成功后即返回统计结果，前端一次请求完成「记录 + 展示」，减少一次往返
    const todayRow = await prisma.visitStat.findUnique({ where: { date: today } });
    const all = await prisma.visitStat.aggregate({ _sum: { pv: true, uv: true } });

    const res = NextResponse.json({
      ok: true,
      todayPv: todayRow?.pv ?? 0,
      todayUv: todayRow?.uv ?? 0,
      totalPv: all._sum.pv ?? 0,
      totalUv: all._sum.uv ?? 0,
    });
    if (isNew) {
      res.cookies.set(UV_COOKIE, "1", {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: UV_COOKIE_MAX_AGE,
      });
    }
    return res;
  } catch (e) {
    return internalError("[POST /api/stats] 记录失败", e);
  }
}
