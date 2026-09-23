import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  internalError, error, success, requireSession, parseJsonBody,
  formatZodError, writeOperationLog, getClientIp,
  isRateLimited,
} from "@/lib/server";
import { announcementSchema, announcementBatchSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** 后台：公告列表（全部，含未上线/过期，倒序）+ 新增（仅管理员） */
export async function GET() {
  try {
    const session = await requireSession();
    if (!session) {
      return error("未授权", 401);
    }
    const list = await prisma.siteAnnouncement.findMany({
      orderBy: [{ pinned: "desc" }, { sort: "asc" }, { createdAt: "desc" }],
    });
    return NextResponse.json(list);
  } catch (e) {
    return internalError("[GET /api/announcements] 查询失败", e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();
    if (!session) {
      return error("未授权", 401);
    }
    const json = await parseJsonBody(request);
    if (json === null) {
      return error("请求体格式错误，需为合法 JSON");
    }
    const parsed = announcementSchema.safeParse(json);
    if (!parsed.success) {
      return error(`参数校验失败：${formatZodError(parsed.error)}`);
    }

    const data = parsed.data;
    const created = await prisma.siteAnnouncement.create({
      data: {
        title: data.title,
        content: data.content,
        pinned: data.pinned,
        enabled: data.enabled,
        sort: data.sort,
        startAt: data.startAt ? new Date(data.startAt) : null,
        endAt: data.endAt ? new Date(data.endAt) : null,
      },
    });

    const username = session.user?.name || "unknown";
    await writeOperationLog({
      module: "announcements",
      action: "create",
      username,
      summary: `发布公告「${data.title}」`,
      ip: getClientIp(request),
    });
    return success(created, 201);
  } catch (e) {
    return internalError("[POST /api/announcements] 创建失败", e);
  }
}

/** 后台：批量保存公告（整表替换语义，与链接面板一致）。项含 id 则更新、无 id 则新增、未提交则删除。 */
export async function PUT(request: NextRequest) {
  try {
    const session = await requireSession();
    if (!session) {
      return error("未授权", 401);
    }
    // 【Rate Limit】批量覆盖写入：每用户 60s 最多 10 次
    if (isRateLimited(`announcements-batch:${session.user?.name || "unknown"}`)) return error("操作过于频繁，请稍后再试", 429);
    const json = await parseJsonBody(request);
    if (!Array.isArray(json)) {
      return error("请求体需为公告数组");
    }
    const parsed = announcementBatchSchema.safeParse(json);
    if (!parsed.success) {
      return error(`参数校验失败：${formatZodError(parsed.error)}`);
    }
    const items = parsed.data;
    const username = session.user?.name || "unknown";
    const ip = getClientIp(request);

    const dataOf = (it: (typeof items)[number]) => ({
      title: it.title,
      content: it.content,
      pinned: it.pinned,
      enabled: it.enabled,
      sort: it.sort,
      startAt: it.startAt ? new Date(it.startAt) : null,
      endAt: it.endAt ? new Date(it.endAt) : null,
    });

    const result = await prisma.$transaction(async (tx) => {
      const existingRows = await tx.siteAnnouncement.findMany({ select: { id: true } });
      const existingIds = existingRows.map((r) => r.id);
      const submitIds = items.filter((it) => it.id != null).map((it) => it.id!);

      let createdCount = 0;
      let updatedCount = 0;
      for (const it of items) {
        // id 存在且属于现有关键更新，否则按新增处理（避免陈旧 id 触发 update 报错）
        if (it.id != null && existingIds.includes(it.id)) {
          await tx.siteAnnouncement.update({ where: { id: it.id }, data: dataOf(it) });
          updatedCount += 1;
        } else {
          await tx.siteAnnouncement.create({ data: dataOf(it) });
          createdCount += 1;
        }
      }

      // 整表替换：删除未被提交的旧记录
      const toDelete = existingIds.filter((id) => !submitIds.includes(id));
      let deletedCount = 0;
      if (toDelete.length > 0) {
        const del = await tx.siteAnnouncement.deleteMany({ where: { id: { in: toDelete } } });
        deletedCount = del.count;
      }

      await tx.operationLog.create({
        data: {
          module: "announcements",
          action: "batch_update",
          username,
          summary: `批量保存公告：新增 ${createdCount} / 更新 ${updatedCount} / 删除 ${deletedCount}`,
          detail: JSON.stringify({ createdCount, updatedCount, deletedCount }),
          ip,
        },
      });
      return { createdCount, updatedCount, deletedCount };
    });

    const list = await prisma.siteAnnouncement.findMany({
      orderBy: [{ pinned: "desc" }, { sort: "asc" }, { createdAt: "desc" }],
    });
    return NextResponse.json({ list, ...result });
  } catch (e) {
    return internalError("[PUT /api/announcements] 批量保存失败", e);
  }
}