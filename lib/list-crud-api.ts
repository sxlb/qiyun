/**
 * 列表型资源（projects / skills / announcements）的通用 CRUD API 工厂。
 * 覆盖 GET 列表、POST 新增、PUT 批量保存三大操作，消除重复样板代码。
 */

import type { ZodType } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, error, success, internalError, parseJsonBody, formatZodError } from "@/lib/server";
import { getClientIp, writeOperationLog, LogModule } from "@/lib/server";
import { syncByUpsert } from "./link-list-api";

export interface BatchCrudConfig<Item extends Record<string, unknown>, S extends ZodType<Item>> {
  /** 操作日志模块名（projects / skills / announcements） */
  module: Extract<LogModule, "projects" | "skills" | "announcements">;
  /** 资源标签（用于错误提示和日志摘要） */
  label: string;
  /** 单条记录校验 schema（如 projectSchema / skillSchema） */
  schema: S;
  /** 批量记录校验 schema（带可选 id 扩展版） */
  batchSchema: ZodType<(Item & { id?: number })[]>;
  /** 获取模型委托（事务内或直连），如 (tx) => tx.project 或 () => prisma.project */
  model: (db: unknown) => {
    findMany(args?: { orderBy?: unknown[]; select?: Record<string, unknown> }): Promise<Record<string, unknown>[]>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    update(args: { where: { id: number }; data: Record<string, unknown> }): Promise<unknown>;
    deleteMany(args: { where: { id: { in: number[] } } }): Promise<{ count: number }>;
  };
  /** 排序规则（Prisma orderBy 格式） */
  orderBy?: unknown[];
  /** 从入参提取存储数据的函数 */
  dataOf: (item: Item) => Record<string, unknown>;
  /** 自定义 POST 日志摘要回调 */
  postLogSummary?: (item: Item) => string;
  /** 主键字段名（默认 "title"） */
  nameField?: keyof Item;
}

/** 为列表型资源生成 GET / POST / PUT 路由 */
export function createBatchCrudApi<Item extends Record<string, unknown>, S extends ZodType<Item>>(
  config: BatchCrudConfig<Item, S>
) {
  const { module, label, schema, batchSchema, model, orderBy, dataOf, postLogSummary, nameField = "title" as keyof Item } = config;
  const defaultOrderBy = [{ sort: "asc" as const }, { id: "asc" as const }];
  const ORDER = { orderBy: orderBy ?? defaultOrderBy };

  async function GET() {
    try {
      const session = await requireSession();
      if (!session) return error("未授权", 401);
      const list = await model(prisma).findMany(ORDER);
      return NextResponse.json(list);
    } catch (e) {
      return internalError(`[GET ${label}] 查询失败`, e);
    }
  }

  async function POST(request: NextRequest) {
    try {
      const session = await requireSession();
      if (!session) return error("未授权", 401);

      const json = await parseJsonBody(request);
      if (json === null) return error("请求体格式错误，需为合法 JSON");

      const parsed = schema.safeParse(json);
      if (!parsed.success) return error(`参数校验失败：${formatZodError(parsed.error)}`);

      const created = await model(prisma).create({ data: dataOf(parsed.data) });

      const username = session.user?.name || "unknown";
      const nameVal = parsed.data[nameField] as string;
      await writeOperationLog({
        module,
        action: "create",
        username,
        summary: postLogSummary?.(parsed.data) ?? `新增${label}「${nameVal}」`,
        ip: getClientIp(request),
      });

      return success(created, 201);
    } catch (e) {
      return internalError(`[POST ${label}] 创建失败`, e);
    }
  }

  async function PUT(request: NextRequest) {
    try {
      const session = await requireSession();
      if (!session) return error("未授权", 401);

      const json = await parseJsonBody(request);
      if (!Array.isArray(json)) return error(`请求体需为${label}数组`);

      const parsed = batchSchema.safeParse(json);
      if (!parsed.success) return error(`参数校验失败：${formatZodError(parsed.error!)}`);

      const items = parsed.data;
      const ip = getClientIp(request);

      const result = await prisma.$transaction(async (tx) => {
        const m = model(tx);

        const counts = await syncByUpsert<Item>(
          items,
          {
            listIds: () => m.findMany({ select: { id: true } }).then((rows) => rows.map((r) => r.id as number)),
            updateById: (id: number, _data: Item) => m.update({ where: { id }, data: dataOf(_data) }),
            create: (data: Item) => m.create({ data: dataOf(data) }),
            deleteMissing: (ids: number[]) => m.deleteMany({ where: { id: { in: ids } } }).then((res) => res.count),
            writeLog: async (cnts) => {
              const username = session.user?.name || "unknown";
              await tx.operationLog.create({
                data: {
                  module,
                  action: "batch_update",
                  username,
                  summary: `批量保存${label}：新增 ${cnts.createdCount} / 更新 ${cnts.updatedCount} / 删除 ${cnts.deletedCount}`,
                  detail: JSON.stringify(cnts),
                  ip,
                },
              });
            },
          }
        );

        return { createdCount: counts.createdCount, updatedCount: counts.updatedCount, deletedCount: counts.deletedCount };
      });

      const list = await model(prisma).findMany(ORDER);
      return NextResponse.json({ list, ...result });
    } catch (e) {
      return internalError(`[PUT ${label}] 批量保存失败`, e);
    }
  }

  return { GET, POST, PUT };
}
