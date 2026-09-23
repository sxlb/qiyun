import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildBackup } from "@/lib/backup";
import { requireSession, error, internalError } from "@/lib/server";

export const dynamic = "force-dynamic";

/**
 * 下载完整备份（v3）。
 * 覆盖范围：站点配置 + 社交/网站/友情链接 + 作品集 + 技能云 + 站点公告
 *          + 媒体库记录 + 链接点击统计。
 *
 * 不包含（有意排除，理由如下）：
 * - 账号（User）：避免备份文件携带口令哈希；账号请通过「账号与安全」单独管理。
 * - 操作日志 / 访问统计 / 更新记录：属运维遥测数据，体量大且无迁移价值。
 * - 已上传的图片文件本身：二进制无法放进 JSON。文件位于 data/uploads，
 *   迁移时请随目录一并拷贝；媒体库记录恢复后即指向这些文件。
 */
export async function GET() {
  try {
    const session = await requireSession();
    if (!session) return error("未授权", 401);

    // linkClicks 按 count 降序排列，方便恢复时快速定位热门链接。
    // 注意：备份文件仅含本站数据，不涉及第三方信息泄露。
    const [
      profile,
      socialLinks,
      siteLinks,
      friendLinks,
      projects,
      skills,
      announcements,
      media,
      linkClicks,
    ] = await Promise.all([
      prisma.profile.findFirst({ orderBy: { id: "asc" } }),
      prisma.socialLink.findMany({ orderBy: [{ sort: "asc" }, { id: "asc" }] }),
      prisma.siteLink.findMany({ orderBy: [{ sort: "asc" }, { id: "asc" }] }),
      prisma.friendLink.findMany({ orderBy: [{ sort: "asc" }, { id: "asc" }] }),
      prisma.project.findMany({ orderBy: [{ sort: "asc" }, { id: "asc" }] }),
      prisma.skill.findMany({ orderBy: [{ sort: "asc" }, { id: "asc" }] }),
      prisma.siteAnnouncement.findMany({ orderBy: [{ sort: "asc" }, { id: "asc" }] }),
      prisma.imageAsset.findMany({ orderBy: { id: "asc" } }),
      prisma.siteLinkClick.findMany({ orderBy: { count: "desc" } }),
    ]);

    const asRows = (v: unknown) => v as Record<string, unknown>[];
    const backup = buildBackup(
      (profile as unknown as Record<string, unknown>) ?? {},
      asRows(socialLinks),
      asRows(siteLinks),
      asRows(friendLinks),
      {
        projects: asRows(projects),
        skills: asRows(skills),
        announcements: asRows(announcements),
        media: asRows(media),
        linkClicks: asRows(linkClicks),
      }
    );

    // 文件名带时分秒：同日多次备份不再互相覆盖，便于回档时挑选时间点
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "").slice(0, 14);
    return new NextResponse(JSON.stringify(backup, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="qiyun-backup-${stamp}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return internalError("[GET /api/backup] 导出失败", e);
  }
}
