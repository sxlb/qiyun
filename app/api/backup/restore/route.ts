import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { restoreBackup } from "@/lib/backup";
import { requireSession, error, readTextWithLimit, internalError, writeOperationLog, getClientIp } from "@/lib/server";
import { isRateLimited } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** 最大恢复体积（5MB） */
const MAX_RESTORE_BYTES = 5 * 1024 * 1024;

/** 恢复备份：危险操作，需 confirm: true 且备份结构合法 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();
    if (!session) return error("未授权", 401);

    // 【VULN-05】备份恢复是高危操作：全局限流（每 60s 最多 3 次），防止会话劫持后快速清空数据库
    const restoreRateKey = `backup-restore:${getClientIp(request)}`;
    if (isRateLimited(restoreRateKey, 3)) return error("操作过于频繁，请稍后再试", 429);

    // 上限必须在**读取过程中**生效：只信 content-length 时，chunked 传输可绕过
    // （该头可缺失或虚报），而 request.json() 会先把整个 body 读进内存。
    const body = await readTextWithLimit(request, MAX_RESTORE_BYTES);
    if (!body.ok) {
      return error(
        body.reason === "over-limit" ? "备份文件过大（超过 5MB）" : "请求体读取失败，请重试",
        400
      );
    }

    let json: { confirm?: boolean; backup?: unknown } | null = null;
    try {
      json = JSON.parse(body.text) as { confirm?: boolean; backup?: unknown };
    } catch {
      json = null;
    }
    if (json === null) {
      return error("请求体格式错误，需为合法 JSON");
    }
    if (json.confirm !== true) {
      return error("请确认后执行恢复操作", 400);
    }

    const result = await restoreBackup(prisma, json.backup);
    if (!result.ok) {
      return error(result.error, 400);
    }

    // 记录操作日志（失败不影响主操作）
    const c = result.count;
    const username = session.user?.name || "unknown";
    await writeOperationLog({
      module: "backup",
      action: "restore",
      username,
      summary:
        `恢复备份：配置 ${c.profile ? "创建" : "更新"}，` +
        `社交 ${c.socialLinks} 条、网站 ${c.siteLinks} 条、友情 ${c.friendLinks} 条、` +
        `作品 ${c.projects} 条、技能 ${c.skills} 条、公告 ${c.announcements} 条、` +
        `媒体记录 ${c.media} 条、链接点击 ${c.linkClicks} 条`,
      ip: getClientIp(request),
    });

    return new Response(JSON.stringify({ ok: true, count: result.count }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return internalError("[POST /api/backup/restore] 恢复失败", e);
  }
}
