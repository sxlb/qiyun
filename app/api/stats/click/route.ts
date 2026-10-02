import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { internalError, error, parseJsonBody, isRateLimited, getClientIp, serialized } from "@/lib/server";

export const dynamic = "force-dynamic";

/**
 * 点击来源类型，取值与首页 LinkTabs 的 tab 一一对应。
 * SiteLink / FriendLink / Project 三张表的自增 id 属于**彼此独立**的空间，
 * 仅凭 id 聚合会把「作品 #3」的点击加到「网站链接 #3」上，因此必须带上来源类型共同定位。
 */
const CLICK_KINDS = ["site", "friend", "project"] as const;
type ClickKind = (typeof CLICK_KINDS)[number];

function isClickKind(value: unknown): value is ClickKind {
  return typeof value === "string" && (CLICK_KINDS as readonly string[]).includes(value);
}

/**
 * 按来源类型回查链接实体，返回**数据库中的权威** name / url。
 *
 * 刻意不采用请求体里的 name/url：该接口无鉴权，任意访客都能直接 POST，
 * 若信任入参就能把任意文字与链接写进后台「热门链接」（投毒 + 存储型 XSS 的原料）。
 * 目标不存在（id 非法或已被删除）时返回 null，由调用方丢弃本次上报。
 */
async function resolveClickTarget(
  kind: ClickKind,
  linkId: number
): Promise<{ name: string; url: string } | null> {
  if (kind === "project") {
    const row = await prisma.project.findUnique({
      where: { id: linkId },
      select: { title: true, url: true },
    });
    return row ? { name: row.title, url: row.url } : null;
  }
  if (kind === "site") {
    const row = await prisma.siteLink.findUnique({
      where: { id: linkId },
      select: { name: true, url: true },
    });
    return row ? { name: row.name, url: row.url } : null;
  }
  const row = await prisma.friendLink.findUnique({
    where: { id: linkId },
    select: { name: true, url: true },
  });
  return row ? { name: row.name, url: row.url } : null;
}

/** 网站/友情链接/作品的点击上报：聚合计数到 SiteLinkClick（用于后台"热门链接"统计） */
export async function POST(request: NextRequest) {
  try {
    // 防刷：按 IP 限流，避免刷点击
    const ip = getClientIp(request) || "unknown";
    if (isRateLimited(`click:${ip}`, 30, 60_000)) {
      return NextResponse.json({ ok: false, error: "请求过于频繁" }, { status: 429 });
    }

    const body = await parseJsonBody<{ id?: number; kind?: string }>(request);
    if (!body) {
      return error("请求体格式错误，需为合法 JSON");
    }
    const linkId = Number(body.id);
    if (!Number.isInteger(linkId) || linkId <= 0) {
      return error("参数校验失败：id 必须为正整数");
    }
    // 未带 kind（升级窗口内的旧前端）按「网站链接」处理；带了但取值非法则直接拒绝，
    // 避免把非法来源静默归入 site 桶而污染统计。
    if (body.kind !== undefined && !isClickKind(body.kind)) {
      return error("参数校验失败：kind 必须为 site / friend / project");
    }
    const kind: ClickKind = body.kind ?? "site";

    // 必须确认目标真实存在：否则任意 id 都能凭空建行，既污染「热门链接」Top 8，
    // 也构成无鉴权的写放大（磁盘增长）入口。
    const target = await resolveClickTarget(kind, linkId);
    if (!target) {
      // 前端是 fire-and-forget（失败静默），这里保持 200 + recorded:false，避免刷错误日志
      return NextResponse.json({ ok: true, recorded: false });
    }

    // upsert 为写操作，放入串行队列避免并发写触发 SQLITE_BUSY
    await serialized(async () => {
      await prisma.siteLinkClick.upsert({
        where: { kind_linkId: { kind, linkId } },
        update: { count: { increment: 1 }, name: target.name, url: target.url },
        create: { kind, linkId, name: target.name, url: target.url, count: 1 },
      });
    });

    return NextResponse.json({ ok: true, recorded: true });
  } catch (e) {
    return internalError("[POST /api/stats/click] 记录点击失败", e);
  }
}
