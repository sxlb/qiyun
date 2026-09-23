import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { ZodTypeAny } from "zod";
import { prisma } from "@/lib/db";
import type { LogModule } from "@/lib/audit";
import type { LinkItem } from "@/lib/audit";
import { requireSession } from "./auth-server";
import { parseJsonBody } from "./request-body";
import { internalError, error } from "./response";
import { formatZodError } from "./response";
import { diffLinks } from "./audit";
import { writeOperationLog } from "./audit";
import { getClientIp } from "./audit";

/**
 * 链接列表路由所需的 Prisma 委托（结构兼容 socialLink / siteLink / friendLink 三个模型）。
 * 由 toLinkDelegate 适配产出，只暴露工厂实际用到的方法。
 */
export interface LinkDelegate {
  findMany(args: {
    orderBy: { sort?: "asc" | "desc"; id?: "asc" | "desc" }[];
  }): Promise<LinkItem[]>;
  /** 库中全部行的 id（用于计算哪些行需要删除） */
  listIds(): Promise<number[]>;
  create(args: { data: Record<string, unknown> }): Promise<LinkItem>;
  /** 按 id 更新（保持自增 id 不变，点击统计因此不会脱钩） */
  update(args: { where: { id: number }; data: Record<string, unknown> }): Promise<LinkItem>;
  /** 按 id 批量删除，返回删除行数 */
  deleteManyByIds(ids: number[]): Promise<number>;
}

/**
 * 把 Prisma 模型委托（如 prisma.socialLink）适配为 LinkDelegate。
 *
 * 这里刻意返回**真实适配对象**而不是直接做类型断言：断言只能骗过编译器，
 * 而 listIds / deleteManyByIds 是 Prisma 原生不存在的方法，必须在运行时真正实现。
 */
export function toLinkDelegate(delegate: unknown): LinkDelegate {
  const d = delegate as {
    findMany(args?: unknown): Promise<unknown[]>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    update(args: { where: { id: number }; data: Record<string, unknown> }): Promise<unknown>;
    deleteMany(args: { where: { id: { in: number[] } } }): Promise<{ count: number }>;
  };
  return {
    findMany: (args) => d.findMany(args) as Promise<LinkItem[]>,
    listIds: async () => {
      const rows = (await d.findMany({ select: { id: true } })) as { id: number }[];
      return rows.map((r) => r.id);
    },
    create: (args) => d.create(args) as Promise<LinkItem>,
    update: (args) => d.update(args) as Promise<LinkItem>,
    deleteManyByIds: async (ids) => {
      if (ids.length === 0) return 0;
      const result = await d.deleteMany({ where: { id: { in: ids } } });
      return result.count;
    },
  };
}

export interface LinkRouteConfig<S extends ZodTypeAny> {
  /** 操作日志模块名（social-links / site-links / friend-links） */
  module: Extract<LogModule, "social-links" | "site-links" | "friend-links">;
  /** 资源名（用于错误提示） */
  label: string;
  /** 单条链接校验 schema（输出类型经 z.infer 推导，避免散落类型断言） */
  schema: S;
  /** 主客户端委托（prisma.socialLink / prisma.siteLink） */
  delegate: LinkDelegate;
  /** 从事务客户端取同名委托（tx.socialLink / tx.siteLink） */
  txDelegate: (tx: unknown) => LinkDelegate;
}

/**
 * 生成"社交链接 / 网站链接"两类高度相似的 REST 路由（GET / POST / PUT）。
 * 两个资源共用一套逻辑：鉴权 → 校验 → 增/删/改 → 事务批量保存 → 操作日志。
 */
export function createLinkListApi<S extends ZodTypeAny>({
  module,
  label,
  schema,
  delegate,
  txDelegate,
}: LinkRouteConfig<S>) {
  // 从 schema 推导记录类型，让 parsed.data / items 具类型，取代散落的类型断言
  type Item = z.infer<S>;
  // 仅对字面量使用 as const（保留可写数组类型，满足 Prisma 参数要求）
  const ORDER = { orderBy: [{ sort: "asc" as const }, { id: "asc" as const }] };
  // 批量保存用 schema：在单条 schema 上追加可选 id。
  // 带 id 的条目按 id 原地更新（**自增 id 保持不变**），否则新增。
  // id 稳定是点击统计正确性的前提：SiteLinkClick 以 linkId 为唯一键聚合，
  // 若每次保存都重建行、id 全变，历史点击会变成孤儿行并在「热门链接」里重复出现。
  const batchSchema = (schema as unknown as z.ZodObject<z.ZodRawShape>).extend({
    id: z.number().int().positive().optional(),
  });
  type BatchItem = Item & { id?: number };

  async function GET() {
    try {
      const links = await delegate.findMany(ORDER);
      return NextResponse.json(links);
    } catch (e) {
      return internalError(`[GET ${label}] 查询失败`, e);
    }
  }

  async function POST(request: NextRequest) {
    try {
      const session = await requireSession();
      if (!session) {
        return error("未授权", 401);
      }

      const json = await parseJsonBody(request);
      if (json === null) {
        return error("请求体格式错误，需为合法 JSON");
      }

      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        return error(`参数校验失败：${formatZodError(parsed.error)}`);
      }

      const created = await delegate.create({ data: parsed.data });
      return NextResponse.json(created, { status: 201 });
    } catch (e) {
      if (e && typeof e === "object" && "code" in e && e.code === "P2002") {
        return error("创建失败：已存在相同数据", 409);
      }
      return internalError(`[POST ${label}] 创建失败`, e);
    }
  }

  /** 去掉 id 字段：Prisma 的 create / update 不接受把主键写进 data */
  function stripId(data: BatchItem): Record<string, unknown> {
    const rest: Record<string, unknown> = { ...data };
    delete rest.id;
    return rest;
  }

  // 批量更新（用于后台保存整个列表）
  //
  // 采用「按 id 增量同步」而非「清空 + 重插」：后者会让所有行的自增 id 每次保存都变化，
  // 而 SiteLinkClick.linkId 依赖该 id 聚合点击量 —— id 一变，历史点击立刻与新行脱钩，
  // 「热门链接」会出现同名多行、计数被永久拆散。此处与项目 / 技能面板共用 syncByUpsert。
  async function PUT(request: NextRequest) {
    try {
      const session = await requireSession();
      if (!session) {
        return error("未授权", 401);
      }

      const json = await parseJsonBody(request);
      if (json === null) {
        return error("请求体格式错误，需为合法 JSON");
      }

      if (!Array.isArray(json)) {
        return error("请求体必须为数组");
      }

      // 逐条校验并收集清洗后的数据（batchSchema 允许携带可选 id）
      const items: BatchItem[] = [];
      for (const item of json) {
        const parsed = batchSchema.safeParse(item);
        if (!parsed.success) {
          return error(`参数校验失败：${formatZodError(parsed.error)}`);
        }
        items.push(parsed.data as BatchItem);
      }

      // 批量保存前：获取旧列表，用于生成操作日志的变更摘要
      const before = await delegate.findMany(ORDER);

      const counts = await prisma.$transaction(async (tx) => {
        const d = txDelegate(tx);
        return syncByUpsert(items, {
          listIds: () => d.listIds(),
          updateById: (id, data) => d.update({ where: { id }, data: stripId(data) }),
          create: (data) => d.create({ data: stripId(data) }),
          deleteMissing: (ids) => d.deleteManyByIds(ids),
        });
      });

      // 记录操作日志（失败不影响主操作）
      const username = session.user?.name || "unknown";
      const { summary, detail } = diffLinks(before, items);
      await writeOperationLog({
        module,
        action: "batch_update",
        username,
        summary,
        detail,
        ip: getClientIp(request),
      });

      return NextResponse.json({
        count: counts.createdCount + counts.updatedCount,
        created: counts.createdCount,
        updated: counts.updatedCount,
        deleted: counts.deletedCount,
      });
    } catch (e) {
      return internalError(`[PUT ${label}] 保存失败`, e);
    }
  }

  return { GET, POST, PUT };
}

// ===== 以下导出来自 upsert.ts（已合并） =====

export interface UpsertItem {
  id?: number | null;
}

export interface UpsertCounts {
  createdCount: number;
  updatedCount: number;
  deletedCount: number;
}

export interface UpsertCallbacks<T extends UpsertItem> {
  listIds: () => Promise<number[]>;
  updateById: (id: number, data: T) => Promise<unknown>;
  create: (data: T) => Promise<unknown>;
  deleteMissing: (ids: number[]) => Promise<number>;
  writeLog?: (counts: UpsertCounts) => Promise<unknown>;
}

/**
 * 在事务内同步数据：返回增/改/删计数。
 * 注意：本函数自身不开启事务，调用方应在 prisma.$transaction 内使用。
 */
export async function syncByUpsert<T extends UpsertItem>(
  items: T[],
  cb: UpsertCallbacks<T>
): Promise<UpsertCounts> {
  const existingIds = await cb.listIds();
  const submitIds = items.filter((it) => it.id != null).map((it) => it.id!);

  let createdCount = 0;
  let updatedCount = 0;
  for (const it of items) {
    if (it.id != null && existingIds.includes(it.id)) {
      await cb.updateById(it.id, it);
      updatedCount += 1;
    } else {
      await cb.create(it);
      createdCount += 1;
    }
  }

  const toDelete = existingIds.filter((id) => !submitIds.includes(id));
  let deletedCount = 0;
  if (toDelete.length > 0) {
    deletedCount = await cb.deleteMissing(toDelete);
  }

  const counts = { createdCount, updatedCount, deletedCount };
  if (cb.writeLog) await cb.writeLog(counts);
  return counts;
}
