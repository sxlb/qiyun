import { NextResponse, NextRequest } from "next/server";
import path from "node:path";
import { promises as fs } from "node:fs";
import { prisma } from "@/lib/db";
import { requireSession, error, internalError, getClientIp, writeOperationLog, parseJsonBody, isRateLimited } from "@/lib/server";
import { recordFailedAttempt, getLoginRateLimitKey } from "@/lib/auth";
import { getUploadsDir } from "@/lib/uploads";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";

/** 默认社交链接种子数据（与 seed.js 一致） */
const DEFAULT_SOCIAL_LINKS = [
  { name: "GitHub", icon: "github", url: "https://github.com", tip: "去 Github 看看", sort: 0 },
  { name: "BiliBili", icon: "bilibili", url: "https://space.bilibili.com", tip: "(゜-゜)つロ 干杯~", sort: 1 },
  { name: "Email", icon: "mail", url: "mailto:example@example.com", tip: "来封 Email~", sort: 2 },
  { name: "Twitter", icon: "twitter", url: "https://x.com", tip: "你懂的~", sort: 3 },
  { name: "Telegram", icon: "send", url: "https://t.me", tip: "你懂的~", sort: 4 },
];

/** 默认网站链接种子数据（与 seed.js 一致） */
const DEFAULT_SITE_LINKS = [
  { name: "博客", icon: "book-open", url: "https://example.com/blog", sort: 0 },
  { name: "网盘", icon: "cloud", url: "https://example.com/pan", sort: 1 },
  { name: "音乐", icon: "music", url: "music:", sort: 2 },
  { name: "起始页", icon: "compass", url: "https://example.com/nav", sort: 3 },
  { name: "网址集", icon: "link", url: "https://example.com/web", sort: 4 },
  { name: "今日热榜", icon: "flame", url: "https://example.com/hot", sort: 5 },
];

/** Prisma 事务中模型名称映射表（数据库表名 → tx 属性名） */
const MODEL_MAP: Array<{ dbTable: string; modelKey: string }> = [
  { dbTable: "VisitRecord", modelKey: "visitRecord" },
  { dbTable: "SiteLinkClick", modelKey: "siteLinkClick" },
  { dbTable: "OperationLog", modelKey: "operationLog" },
  { dbTable: "UpdateRecord", modelKey: "updateRecord" },
  { dbTable: "SiteAnnouncement", modelKey: "siteAnnouncement" },
  { dbTable: "ImageAsset", modelKey: "imageAsset" },
  { dbTable: "Project", modelKey: "project" },
  { dbTable: "Skill", modelKey: "skill" },
  { dbTable: "FriendLink", modelKey: "friendLink" },
  { dbTable: "SocialLink", modelKey: "socialLink" },
  { dbTable: "SiteLink", modelKey: "siteLink" },
  { dbTable: "VisitStat", modelKey: "visitStat" },
];

type ResetStats = {
  cleared: Record<string, number>;
  seedsCreated: Record<string, number>;
  /** 已删除的孤儿上传文件数（仅统计成功删除的） */
  removedFiles: number;
};

/**
 * 清空 uploads 目录中的全部上传文件。
 *
 * 重置会清空 ImageAsset 表，若不同步删除物理文件，这些图片将永远无法从界面触及，
 * 成为只占磁盘的孤儿文件。仅处理 uploads 目录（壁纸缓存位于 wallpapers，不受影响），
 * 且失败不影响主流程（返回成功删除的数量）。
 */
async function purgeUploadedFiles(): Promise<number> {
  const dir = getUploadsDir();
  let removed = 0;
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      try {
        await fs.unlink(path.join(dir, entry.name));
        removed += 1;
      } catch {
        /* 单个文件删除失败（占用/权限）不影响其余文件 */
      }
    }
  } catch {
    /* 目录不存在视为无需清理 */
  }
  return removed;
}

/**
 * 恢复默认状态：清空全部业务数据并重建种子默认值。危险操作，需三重确认：
 * 1) 已登录会话；2) 请求体 confirm=true；3) **校验当前登录密码**。
 *
 * 第 3 点是必需的：本操作会把管理员密码重置为默认弱口令 123456，
 * 若仅凭会话即可执行，攻击者一旦窃取会话就能把账号降级到已知口令完成持久化。
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();
    if (!session) {
      return error("未授权", 401);
    }

    // 【Rate Limit】重置默认是高危不可逆操作：每用户 60s 最多 3 次
    if (isRateLimited(`reset-default:${session.user?.name || "unknown"}`, 3)) return error("操作过于频繁，请稍后再试", 429);

    const body = await parseJsonBody<{ confirm?: boolean; password?: string }>(request);
    if (body === null) {
      return error("请求体格式错误，需为合法 JSON");
    }
    if (body.confirm !== true) {
      return error("请确认后执行重置操作（危险！）");
    }

    const password = typeof body.password === "string" ? body.password : "";
    if (!password) {
      return error("请输入当前登录密码以确认身份");
    }

    // 二次验证当前密码（与「账号与安全」改密同级强度）
    const username = session.user?.name;
    const currentUser = username
      ? await prisma.user.findUnique({ where: { username } })
      : null;
    if (!currentUser) {
      return error("用户不存在", 404);
    }
    const passwordOk = await bcrypt.compare(password, currentUser.password);
    if (!passwordOk) {
      // 计入登录限流：防止用重置接口暴力猜解当前密码
      recordFailedAttempt(getLoginRateLimitKey(request.headers));
      return error("当前密码不正确", 403);
    }

    const operator = username || "unknown";
    const stats: ResetStats = { cleared: {}, seedsCreated: {}, removedFiles: 0 };

    // 使用事务确保原子性：要么全部成功，要么全部回滚
    await prisma.$transaction(async (tx) => {
      const txMap = tx as Record<string, unknown>;

      // ===== 第一阶段：清空所有业务表 =====
      for (const { dbTable, modelKey } of MODEL_MAP) {
        const t = txMap[modelKey];
        if (!t) continue;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const typedT = t as any;
        try {
          if (typedT.count) {
            const c = await typedT.count();
            await typedT.deleteMany?.();
            (stats.cleared as Record<string, number>)[dbTable] = typeof c === "number" ? c : Number(c);
          } else {
            await typedT.deleteMany?.();
            (stats.cleared as Record<string, number>)[dbTable] = 1;
          }
        } catch {
          // 表可能不存在（旧版本数据库），忽略
        }
      }

      // 手动处理 Profile（count+delete 而非 deleteMany）
      try {
        const profile = txMap.profile as Record<string, unknown>;
        const findFirstFn = typeof profile?.findFirst === "function" ? profile.findFirst.bind(profile) : undefined;
        const existingProfile = await findFirstFn?.({ orderBy: { id: "asc" } }) as { id: number } | null;
        if (existingProfile) {
          (stats.cleared as Record<string, number>)["Profile"] = 1;
          const deleteFn = typeof profile?.delete === "function" ? (profile.delete as (params: { where: { id: number } }) => Promise<void>).bind(profile) : undefined;
          await deleteFn?.({ where: { id: existingProfile.id } });
        } else {
          (stats.cleared as Record<string, number>)["Profile"] = 0;
        }
      } catch {}

      // ===== 第二阶段：重新注入种子默认数据 =====
      // Profile
      const profileCreate = txMap.profile as { create?(data: Record<string, unknown>): Promise<unknown> };
      await profileCreate!.create!({
        data: {
          avatar: "", siteIcon: "", nickname: "无名", bio: "这个人很懒，什么都没写",
          github: "", email: "", weatherProvider: "tencent", amapKey: "", txWeatherKey: "", weatherCity: "",
        },
      });
      stats.seedsCreated["Profile"] = 1;

      // SocialLink
      const socialLinkCreateMany = txMap.socialLink as { createMany?(data: { data: unknown[] }): Promise<unknown> };
      await socialLinkCreateMany!.createMany!({ data: DEFAULT_SOCIAL_LINKS });
      stats.seedsCreated["SocialLink"] = DEFAULT_SOCIAL_LINKS.length;

      // SiteLink
      const siteLinkCreateMany = txMap.siteLink as { createMany?(data: { data: unknown[] }): Promise<unknown> };
      await siteLinkCreateMany!.createMany!({ data: DEFAULT_SITE_LINKS });
      stats.seedsCreated["SiteLink"] = DEFAULT_SITE_LINKS.length;

      // ===== 第三阶段：用户账号处理 =====
      const user = txMap.user as Record<string, unknown>;
      const findUniqueFn = typeof user?.findUnique === "function" ? (user.findUnique as (where: { username: string }) => Promise<{ id: number } | null>).bind(user) : undefined;
      const adminUser = await findUniqueFn?.({ username: "admin" });
      if (adminUser) {
        // 【Critical 修复】重置密码改用更安全的 bcrypt 轮次（12，原为 10）+ 弱口令提示
        // mustChangePassword 强制首次登录立即改密，防止弱口令残留
        const hashed = await bcrypt.hash("123456", 12);
        const updateFn = typeof user?.update === "function" ? (user.update as (params: { where: { id: number }; data: Record<string, unknown> }) => Promise<void>).bind(user) : undefined;
        // sessionVersion 自增：让重置前签发的全部 JWT 立即失效，
        // 避免攻击者持有的旧会话在密码被降级后仍可继续使用
        await updateFn?.({
          where: { id: adminUser.id },
          data: { password: hashed, mustChangePassword: true, sessionVersion: { increment: 1 } },
        });
        stats.seedsCreated["User"] = 1;
      }
    });

    // 事务成功后清理孤儿上传文件（失败不影响主流程，仅不计数）
    stats.removedFiles = await purgeUploadedFiles();

    // 记录操作日志（失败不影响主操作）
    await writeOperationLog({
      module: "system",
      action: "reset_defaults",
      username: operator,
      summary: `已重置全部业务数据为默认状态（含清理 ${stats.removedFiles} 个上传文件）`,
      detail: JSON.stringify(stats),
      ip: getClientIp(request),
    });

    const totalCleared = Object.values(stats.cleared).reduce((a, b) => a + b, 0);
    const totalSeeded = Object.values(stats.seedsCreated).reduce((a, b) => a + b, 0);

    return NextResponse.json({
      ok: true,
      message:
        `恢复默认成功：清空 ${totalCleared} 条记录，重建 ${totalSeeded} 条默认数据` +
        (stats.removedFiles > 0 ? `，清理 ${stats.removedFiles} 个上传文件` : ""),
      stats,
    });
  } catch (e) {
    console.error("[POST /api/reset-default] 重置失败:", e);
    return internalError("重置默认失败", e);
  }
}
