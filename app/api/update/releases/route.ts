import { NextRequest } from "next/server";
import { requireSession, success, error, internalError } from "@/lib/server";
import { CURRENT_VERSION, compareVersions, fetchReleaseList, type ReleaseInfo } from "@/lib/version";

export const dynamic = "force-dynamic";

/** 每条发布相对当前版本的位置：决定后台该给「更新」还是「回滚」按钮 */
export type ReleaseRelation = "newer" | "current" | "older";

export interface ReleaseListItem extends ReleaseInfo {
  relation: ReleaseRelation;
}

/**
 * 发布列表：GET /api/update/releases（仅管理员）
 *
 * 后台「版本列表与更新日志」区块用：把 GitHub 上已发布的版本连同各自的更新说明一起返回
 * （新的在前），并逐条标出它相对当前版本是更新 / 当前 / 历史 —— 后台据此决定按钮文案。
 *
 * 之所以独立成一个接口而不是塞进 /api/update/status：status 在有任务时每 5 秒轮询一次，
 * 而列表里每条都带 Markdown 说明正文（30 条可能上百 KB），挂在一起会把轮询变成流量黑洞。
 *
 * 查询参数 force=1：绕过 10 分钟的进程内缓存，强制重新拉取。
 */
export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return error("未授权", 401);

  try {
    const force = new URL(req.url).searchParams.get("force") === "1";
    const { data, error: listError } = await fetchReleaseList(force);

    const releases: ReleaseListItem[] = data.map((r) => {
      const cmp = compareVersions(r.version, CURRENT_VERSION);
      return { ...r, relation: cmp > 0 ? "newer" : cmp === 0 ? "current" : "older" };
    });

    return success({
      currentVersion: CURRENT_VERSION,
      releases,
      // 拉取失败时 releases 为空且带 error：后台要能区分「没发布过」和「取不到」
      error: listError ?? null,
    });
  } catch (e) {
    return internalError("获取版本列表失败", e);
  }
}
