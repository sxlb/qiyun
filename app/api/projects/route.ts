import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  internalError, error, success, requireSession, parseJsonBody,
  formatZodError, getClientIp, writeOperationLog, syncByUpsert,
  isRateLimited,
} from "@/lib/server";
import { projectSchema, projectBatchSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

const ORDER = [{ featured: "desc" as const }, { sort: "asc" as const }, { id: "asc" as const }];

const dataOf = (it: { title: string; description: string; url: string; image: string; tags: string; featured: boolean; enabled: boolean; sort: number }) => ({
  title: it.title,
  description: it.description,
  url: it.url,
  image: it.image,
  tags: it.tags,
  featured: it.featured,
  enabled: it.enabled,
  sort: it.sort,
});

/** 后台：作品列表（全部，含未启用）+ 新增（仅管理员） */
export async function GET() {
  try {
    const session = await requireSession();
    if (!session) return error("未授权", 401);
    const list = await prisma.project.findMany({ orderBy: ORDER });
    return NextResponse.json(list);
  } catch (e) {
    return internalError("[GET /api/projects] 查询失败", e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();
    if (!session) return error("未授权", 401);
    const json = await parseJsonBody(request);
    if (json === null) return error("请求体格式错误，需为合法 JSON");
    const parsed = projectSchema.safeParse(json);
    if (!parsed.success) return error(`参数校验失败：${formatZodError(parsed.error)}`);
    const created = await prisma.project.create({ data: dataOf(parsed.data) });
    await writeOperationLog({
      module: "projects",
      action: "create",
      username: session.user?.name || "unknown",
      summary: `新增作品「${parsed.data.title}」`,
      ip: getClientIp(request),
    });
    return success(created, 201);
  } catch (e) {
    return internalError("[POST /api/projects] 创建失败", e);
  }
}

/** 后台：批量保存作品（整表替换语义）。项含 id 则更新、无 id 则新增、未提交则删除。 */
export async function PUT(request: NextRequest) {
  try {
    const session = await requireSession();
    if (!session) return error("未授权", 401);
    // 【Rate Limit】批量覆盖写入（含删除重建）：每用户 60s 最多 10 次
    if (isRateLimited(`projects-batch:${session.user?.name || "unknown"}`)) return error("操作过于频繁，请稍后再试", 429);
    const json = await parseJsonBody(request);
    if (!Array.isArray(json)) return error("请求体需为作品数组");
    const parsed = projectBatchSchema.safeParse(json);
    if (!parsed.success) return error(`参数校验失败：${formatZodError(parsed.error)}`);
    const items = parsed.data;
    const ip = getClientIp(request);

    const result = await prisma.$transaction(async (tx) =>
      syncByUpsert(items, {
        listIds: async () => (await tx.project.findMany({ select: { id: true } })).map((r) => r.id),
        updateById: (id, it) => tx.project.update({ where: { id }, data: dataOf(it) }),
        create: (it) => tx.project.create({ data: dataOf(it) }),
        deleteMissing: (ids) => tx.project.deleteMany({ where: { id: { in: ids } } }).then((r) => r.count),
        writeLog: (c) =>
          tx.operationLog.create({
            data: {
              module: "projects",
              action: "batch_update",
              username: session.user?.name || "unknown",
              summary: `批量保存作品：新增 ${c.createdCount} / 更新 ${c.updatedCount} / 删除 ${c.deletedCount}`,
              detail: JSON.stringify(c),
              ip,
            },
          }),
      })
    );

    const list = await prisma.project.findMany({ orderBy: ORDER });
    return NextResponse.json({ list, ...result });
  } catch (e) {
    return internalError("[PUT /api/projects] 批量保存失败", e);
  }
}