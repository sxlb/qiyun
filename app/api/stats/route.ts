import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { internalError, isRateLimited, getClientIp, serialized } from "@/lib/server";
import { parseUserAgent, extractReferrerDomain, nowHour, isBotUserAgent, cnDateStr } from "@/lib/stats";
import { regionKey } from "@/lib/geo";
import { hashIp } from "@/lib/visitor-ip";

export const dynamic = "force-dynamic";

// UV 去重 Cookie：服务端签发，客户端无法伪造"新访客"
const UV_COOKIE = "qiyun-uv";
const UV_COOKIE_MAX_AGE = 365 * 24 * 60 * 60; // 一年

/**
 * 【VULN-03 修复】PV 上报接口本身不需要请求体，
 * 超过该阈值直接拒绝，避免超大 body 被缓冲进内存造成资源放大攻击。
 */
const STATS_MAX_BODY_BYTES = 1024;

/**
 * 访问明细保留天数（`date` 早于该天数的 VisitRecord 会被清理，0 表示永久保留）。
 *
 * 背景：VisitRecord 每有一位非机器人访客就写一行，而 /api/logs/clean 只清操作日志，
 * 长期运行会让 SQLite 文件与统计聚合无界增长。明细只服务于近期看板，
 * 故默认保留 180 天，可用 VISIT_RECORD_RETENTION_DAYS 调整。
 */
const VISIT_RETENTION_DAYS = (() => {
  const raw = Number(process.env.VISIT_RECORD_RETENTION_DAYS);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 180;
})();

/** 进程内记录「今天是否已清理过」，避免每次上报都执行删除 */
let lastPruneDate = "";

/**
 * 站点是否以 HTTPS 对外提供服务（决定 UV Cookie 是否附加 Secure 标志）。
 *
 * 【VULN-15】Secure Cookie 可防止明文 HTTP 链路上的 Cookie 窃取；
 * 但若在 HTTP 部署下强制附加该标志，浏览器会直接拒收 → UV 去重失效（每个请求都被当成新访客）。
 * 故以 NEXTAUTH_URL 的协议为准；未配置时按 NODE_ENV 兜底（生产默认视为 HTTPS 部署）。
 */
function isHttpsDeployment(): boolean {
  const url = process.env.NEXTAUTH_URL || "";
  if (url) return url.startsWith("https://");
  return process.env.NODE_ENV === "production";
}

/**
 * 访问统计 API
 * - POST：记录一次访问。PV 每次 +1；UV 通过服务端 Cookie 判定是否新访客（+1），
 *   不再信任客户端上报的 isNewVisitor，防止脚本无限刷 UV
 * - GET：返回今日 PV/UV 与累计 PV/UV
 */
export async function GET() {
  try {
    const today = cnDateStr();
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
    // 【VULN-03 修复】先按声明长度拒绝超大请求体（不读取 body，零内存开销）
    const declared = Number(request.headers.get("content-length") || 0);
    if (declared > STATS_MAX_BODY_BYTES) {
      return NextResponse.json({ ok: false, error: "请求体过大" }, { status: 413 });
    }

    // 【VULN-03 修复】防刷：按 IP 限流，从默认 60 次/分钟收紧至 30 次/分钟。
    // 上报属非关键路径，单访客正常浏览远低于该阈值；保留余量以兼容
    // 同一出口 IP 下（NAT / 公共网络）的多设备访问。
    const ip = getClientIp(request) || "unknown";
    if (isRateLimited(`stats:${ip}`, 30, 60_000)) {
      return NextResponse.json({ ok: false, error: "请求过于频繁" }, { status: 429 });
    }

    const today = cnDateStr();

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
        // 过期明细清理：每个自然日最多执行一次（放在写队列内，避免与其它写竞争）。
        // 先置位再删除：即使删除失败也不重试，避免异常情况下每次上报都尝试。
        if (VISIT_RETENTION_DAYS > 0 && lastPruneDate !== today) {
          lastPruneDate = today;
          try {
            const removed = await prisma.visitRecord.deleteMany({
              where: { date: { lt: cnDateStr(VISIT_RETENTION_DAYS) } },
            });
            if (removed.count > 0) {
              console.log(`[POST /api/stats] 已清理 ${removed.count} 条超过 ${VISIT_RETENTION_DAYS} 天的访问明细`);
            }
          } catch (e) {
            console.error("[POST /api/stats] 清理过期访问明细失败:", e);
          }
        }

        // 汇总计数（PV + 新访客则 UV+1）
        await prisma.visitStat.upsert({
          where: { date: today },
          update: { pv: { increment: 1 }, ...(isNew ? { uv: { increment: 1 } } : {}) },
          create: { date: today, pv: 1, uv: isNew ? 1 : 0 },
        });

        // 明细记录：来源域名 + 设备/系统/浏览器 + 时段，供统计增强看板聚合（失败不影响主统计）
        try {
          const { device, os, browser } = parseUserAgent(ua);
          // 【VULN-04】不持久化明文 IP：地域在写入时即解析为标签（供地域分布直接聚合），
          // IP 只保留不可逆哈希用于「独立访客数」去重
          await prisma.visitRecord.create({
            data: {
              date: today,
              hour: nowHour(),
              ipHash: hashIp(ip),
              region: regionKey(ip),
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
        // 【VULN-15】HTTPS 部署下补上 Secure，避免 Cookie 经明文 HTTP 传输被窃取
        secure: isHttpsDeployment(),
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
