import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { internalError, error, requireSession } from "@/lib/server";

export const dynamic = "force-dynamic";

// 查询操作日志（仅后台管理员可用）
// 参数：module=模块筛选 / keyword=关键词（username/summary 模糊匹配）/ page=页码（默认1）/ pageSize=每页条数（默认20，最大100）
export async function GET(request: NextRequest) {
  try {
    const session = await requireSession();
    if (!session) {
      return error("未授权", 401);
    }

    const sp = request.nextUrl.searchParams;
    const moduleFilter = sp.get("module") || undefined;
    const keyword = sp.get("keyword")?.trim() || undefined;

    const rawPage = parseInt(sp.get("page") || "1", 10);
    const page = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;
    const rawPageSize = parseInt(sp.get("pageSize") || "20", 10);
    const pageSize = isNaN(rawPageSize) ? 20 : Math.min(Math.max(rawPageSize, 1), 100);

    const where = {
      ...(moduleFilter ? { module: moduleFilter } : {}),
      ...(keyword
        ? { OR: [{ username: { contains: keyword } }, { summary: { contains: keyword } }] }
        : {}),
    };

    const [total, items] = await Promise.all([
      prisma.operationLog.count({ where }),
      prisma.operationLog.findMany({
        where,
        orderBy: { id: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return NextResponse.json({ items, total, page, pageSize });
  } catch (e) {
    return internalError("[GET /api/operation-logs] 查询失败", e);
  }
}
