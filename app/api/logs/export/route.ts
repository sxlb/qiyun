import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  requireSession,
  error,
  internalError,
  getClientIp,
  writeOperationLog,
} from "@/lib/server";
import { toCsv } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** 解析 from/to 参数为 Date；空串返回 null；非法返回 null（调用方据此判定） */
function parseRangeParam(raw?: string | null): Date | null | "invalid" {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(
    d.getHours()
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// 导出操作日志为 CSV（按当前筛选条件，UTF-8 BOM，Excel 兼容）
// 参数：module=模块 / keyword=关键词 / from=起始时间(ISO) / to=结束时间(ISO)
export async function GET(request: NextRequest) {
  try {
    const session = await requireSession();
    if (!session) {
      return error("未授权", 401);
    }

    const sp = request.nextUrl.searchParams;
    const moduleFilter = sp.get("module") || undefined;
    const keyword = sp.get("keyword")?.trim() || undefined;

    const from = parseRangeParam(sp.get("from"));
    const to = parseRangeParam(sp.get("to"));
    if (from === "invalid" || to === "invalid") {
      return error("from 或 to 参数不是合法时间");
    }
    if (from && to && from.getTime() > to.getTime()) {
      return error("from 不能晚于 to");
    }

    const createdAt: Record<string, Date> = {};
    if (from) createdAt.gte = from;
    if (to) createdAt.lte = to;

    const where = {
      ...(moduleFilter ? { module: moduleFilter } : {}),
      ...(keyword
        ? { OR: [{ username: { contains: keyword } }, { summary: { contains: keyword } }] }
        : {}),
      ...(Object.keys(createdAt).length ? { createdAt } : {}),
    };

    const logs = await prisma.operationLog.findMany({ where, orderBy: { id: "asc" } });

    const rows = logs.map((l) => [
      l.createdAt.toISOString(),
      l.module,
      l.action,
      l.username,
      l.summary,
      l.detail,
      l.ip,
    ]);
    const csv = toCsv(
      ["时间", "模块", "操作", "操作人", "摘要", "详情", "IP"],
      rows
    );

    // 审计：记录本次导出（失败不影响导出结果）
    const username = session.user?.name || "unknown";
    await writeOperationLog({
      module: "logs",
      action: "export",
      username,
      summary: `导出操作日志 ${logs.length} 条`,
      detail: JSON.stringify({ count: logs.length, from: from?.toISOString() || null, to: to?.toISOString() || null }),
      ip: getClientIp(request),
    });

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="operation-logs-${timestamp()}.csv"`,
      },
    });
  } catch (e) {
    return internalError("[GET /api/logs/export] 导出失败", e);
  }
}