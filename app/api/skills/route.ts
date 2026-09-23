import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  internalError, error, success, requireSession, parseJsonBody,
  formatZodError, getClientIp, writeOperationLog, syncByUpsert,
  isRateLimited,
} from "@/lib/server";
import { skillSchema, skillBatchSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

const ORDER = [{ sort: "asc" as const }, { id: "asc" as const }];

const dataOf = (it: { name: string; level: number; icon: string; sort: number }) => ({
  name: it.name,
  level: it.level,
  icon: it.icon,
  sort: it.sort,
});

/** 后台：技能列表（全部）+ 新增（仅管理员） */
export async function GET() {
  try {
    const session = await requireSession();
    if (!session) return error("未授权", 401);
    const list = await prisma.skill.findMany({ orderBy: ORDER });
    return NextResponse.json(list);
  } catch (e) {
    return internalError("[GET /api/skills] 查询失败", e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();
    if (!session) return error("未授权", 401);
    const json = await parseJsonBody(request);
    if (json === null) return error("请求体格式错误，需为合法 JSON");
    const parsed = skillSchema.safeParse(json);
    if (!parsed.success) return error(`参数校验失败：${formatZodError(parsed.error)}`);
    const created = await prisma.skill.create({ data: dataOf(parsed.data) });
    await writeOperationLog({
      module: "skills",
      action: "create",
      username: session.user?.name || "unknown",
      summary: `新增技能「${parsed.data.name}」`,
      ip: getClientIp(request),
    });
    return success(created, 201);
  } catch (e) {
    return internalError("[POST /api/skills] 创建失败", e);
  }
}

/** 后台：批量保存技能（整表替换语义）。项含 id 则更新、无 id 则新增、未提交则删除。 */
export async function PUT(request: NextRequest) {
  try {
    const session = await requireSession();
    if (!session) return error("未授权", 401);
    // 【Rate Limit】批量覆盖写入：每用户 60s 最多 10 次
    if (isRateLimited(`skills-batch:${session.user?.name || "unknown"}`)) return error("操作过于频繁，请稍后再试", 429);
    const json = await parseJsonBody(request);
    if (!Array.isArray(json)) return error("请求体需为技能数组");
    const parsed = skillBatchSchema.safeParse(json);
    if (!parsed.success) return error(`参数校验失败：${formatZodError(parsed.error)}`);
    const items = parsed.data;
    const ip = getClientIp(request);

    const result = await prisma.$transaction(async (tx) =>
      syncByUpsert(items, {
        listIds: async () => (await tx.skill.findMany({ select: { id: true } })).map((r) => r.id),
        updateById: (id, it) => tx.skill.update({ where: { id }, data: dataOf(it) }),
        create: (it) => tx.skill.create({ data: dataOf(it) }),
        deleteMissing: (ids) => tx.skill.deleteMany({ where: { id: { in: ids } } }).then((r) => r.count),
        writeLog: (c) =>
          tx.operationLog.create({
            data: {
              module: "skills",
              action: "batch_update",
              username: session.user?.name || "unknown",
              summary: `批量保存技能：新增 ${c.createdCount} / 更新 ${c.updatedCount} / 删除 ${c.deletedCount}`,
              detail: JSON.stringify(c),
              ip,
            },
          }),
      })
    );

    const list = await prisma.skill.findMany({ orderBy: ORDER });
    return NextResponse.json({ list, ...result });
  } catch (e) {
    return internalError("[PUT /api/skills] 批量保存失败", e);
  }
}