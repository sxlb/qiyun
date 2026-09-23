import { prisma } from "@/lib/db";
import { requireSession, success, error, internalError } from "@/lib/server";
import {
  CURRENT_VERSION,
  GITHUB_REPO,
  fetchLatestRelease,
  isNewerRelease,
  refreshVersionCache,
} from "@/lib/version";
import {
  execState,
  readVersions,
  rollbackTargets,
  listBackupSnapshots,
} from "@/lib/update";
import type { NextRequest } from "next/server";

/**
 * 系统更新状态：GET /api/update/status
 * 返回当前版本、GitHub 最新发布、是否有新版本、执行状态、更新历史、回滚目标与数据快照。
 * 仅管理员可访问。
 *
 * 查询参数 `force=1`：触发版本缓存强制刷新（"点击检测更新"），
 * 立即从 GitHub 拉取最新 release 并写回缓存，再返回刷新后的状态。
 */
export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return error("未授权", 401);

  try {
    const force = new URL(req.url).searchParams.get("force") === "1";
    // force=true：先强制刷新版本缓存（拉取+写盘），再读取以返回一致结果；
    // 否则直接读缓存/兜底，避免重复网络请求。
    let latest;
    if (force) {
      const r = await refreshVersionCache({ force: true });
      latest = { data: r.data, error: r.error };
    } else {
      latest = await fetchLatestRelease();
    }

    const current = CURRENT_VERSION;
    const isUpdateAvailable = latest.data ? isNewerRelease(latest.data.version, current) : false;

    const exec = execState();
    const versions = readVersions();
    const records = await prisma.updateRecord.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
    });

    // 结果回写：若最新执行结果与某条 pending/running 记录匹配，则收敛其最终状态
    if (exec.lastResult) {
      const open = records.find(
        (r) =>
          (r.status === "pending" || r.status === "running") &&
          r.version === exec.lastResult!.version &&
          r.action === exec.lastResult!.action
      );
      if (open) {
        const finalized = await prisma.updateRecord.update({
          where: { id: open.id },
          data: {
            status: exec.lastResult.status === "running" ? "running" : exec.lastResult.status,
            message: exec.lastResult.message,
            finishedAt: exec.lastResult.status === "running" ? null : new Date(),
            durationSeconds:
              exec.lastResult.status === "running"
                ? null
                : Math.max(0, Math.round((Date.now() - open.createdAt.getTime()) / 1000)),
          },
        });
        records[records.findIndex((r) => r.id === open.id)] = finalized;
      }
    }

    return success({
      currentVersion: current,
      repo: GITHUB_REPO,
      latestRelease: latest.data,
      latestError: latest.error,
      isUpdateAvailable,
      hostReady: Boolean(versions),
      exec,
      versions,
      rollbackTargets: rollbackTargets(),
      backups: listBackupSnapshots(),
      records,
    });
  } catch (e) {
    return internalError("获取更新状态失败", e);
  }
}