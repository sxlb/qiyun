import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { internalError } from "@/lib/server";

export const dynamic = "force-dynamic";

/** 前台：当前有效公告（已启用，且在定时上线/下线区间内）。置顶优先，其次排序。无需登录。 */
export async function GET() {
  try {
    const now = new Date();
    const list = await prisma.siteAnnouncement.findMany({
      where: {
        enabled: true,
        AND: [
          { OR: [{ startAt: null }, { startAt: { lte: now } }] },
          { OR: [{ endAt: null }, { endAt: { gte: now } }] },
        ],
      },
      orderBy: [{ pinned: "desc" }, { sort: "asc" }, { createdAt: "desc" }],
    });
    return NextResponse.json(list);
  } catch (e) {
    return internalError("[GET /api/announcements/public] 查询失败", e);
  }
}