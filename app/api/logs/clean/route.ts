import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  requireSession,
  error,
  internalError,
  parseJsonBody,
  getClientIp,
} from "@/lib/server";

export const dynamic = "force-dynamic";

/** 清理操作日志：按时间段删除（from/to 可丢；都为空=全部清理）。
 *  清理本身写入一条审计日志（在事务内、删除后创建，故不会被本次清理误删）。
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();
    if (!session) {
      return error("未授权", 401);
    }

    const body = await parseJsonBody<{ from?: string; to?: string }>(request);
    if (body === null) {
      return error("请求体格式错误，需为合法 JSON");
    }

    const { from, to } = body;
    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(to) : null;
    if ((from && !fromDate) || Number.isNaN(fromDate?.getTime())) {
      return error("from 不是合法时间");
    }
    if ((to && !toDate) || Number.isNaN(toDate?.getTime())) {
      return error("to 不是合法时间");
    }
    if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
      return error("from 不能晚于 to");
    }

    const createdAt: Record<string, Date> = {};
    if (fromDate) createdAt.gte = fromDate;
    if (toDate) createdAt.lte = toDate;
    // 都为空：{ where: {} } 即清理全部记录
    const where = Object.keys(createdAt).length ? { createdAt } : {};

    const username = session.user?.name || "unknown";

    // 事务：删除 → 写入清理审计（保证审计日志不被本次清理波及）
    const result = await prisma.$transaction(async (tx) => {
      const removed = await tx.operationLog.deleteMany({ where });
      const timeLabel = from && to ? `${from} ~ ${to}` : from ? `${from} 起` : to ? `${to} 止` : "全部";
      const summary = `清理操作日志 ${removed.count} 条（${timeLabel}）`;
      await tx.operationLog.create({
        data: {
          module: "logs",
          action: "clean",
          username,
          summary,
          detail: JSON.stringify({ count: removed.count, from: from || null, to: to || null }),
          ip: getClientIp(request),
        },
      });
      return { count: removed.count, summary };
    });

    return Response.json({ ok: true, deletedCount: result.count, summary: result.summary });
  } catch (e) {
    return internalError("[POST /api/logs/clean] 清理失败", e);
  }
}