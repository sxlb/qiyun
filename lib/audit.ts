import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { profileSchema } from "@/lib/validation";
import { extractForwardedIp, extractRealIp, isValidIp } from "@/lib/ip";

/** 操作日志模块类型 */
export type LogModule =
  | "profile"
  | "social-links"
  | "site-links"
  | "friend-links"
  | "account"
  | "backup"
  | "announcements"
  | "logs" // 操作日志自身：导出 / 清理审计
  | "media" // 媒体库：上传 / 复制 / 删除
  | "update" // 系统更新：检查 / 更新 / 回滚
  | "projects" // 作品集：批量保存
  | "skills" // 技能云：批量保存
  | "system"; // 系统：重置默认、权限变更等

export interface LogInput {
  module: LogModule;
  action: string;
  username: string;
  summary: string;
  detail?: string;
  ip?: string;
}

export interface LinkItem {
  id?: number;
  name: string;
  icon: string;
  url: string;
  tip?: string;
  description?: string;
  sort: number;
}

/**
 * 写入操作日志。
 * 日志写入失败不影响主操作，仅打印错误供排查。
 */
export async function writeOperationLog(input: LogInput) {
  try {
    await prisma.operationLog.create({
      data: {
        module: input.module,
        action: input.action,
        username: input.username,
        summary: input.summary,
        detail: input.detail || "",
        ip: input.ip || "",
      },
    });
  } catch (e) {
    console.error("[operationLog] 写入日志失败:", e);
  }
}

/** 从请求头提取客户端 IP（校验逻辑见 lib/ip.ts，供 auth 等复用避免循环依赖） */
export function getClientIp(req: NextRequest): string {
  const forwarded = extractForwardedIp(req.headers.get("x-forwarded-for"));
  if (forwarded) return forwarded;
  return extractRealIp(req.headers.get("x-real-ip"));
}

// 兼容既有导入：isValidIp 现定义于 lib/ip.ts（此处仅为 re-export）
export { isValidIp };

/** diffLinks 中参与"除 name 外字段比较"的键清单 */
const LINK_KEYS = ["icon", "url", "tip", "description", "sort"] as const;
type LinkKey = (typeof LINK_KEYS)[number];

/** 取指定键的值（keyof 收窄，避免 JS 字符串动态访问） */
function linkValue(l: LinkItem, k: LinkKey) {
  return l[k];
}

/** 两份链接在除 name 之外的字段上是否完全相同（用于识别"仅改名"） */
function linksEqualExceptName(a: LinkItem, b: LinkItem): boolean {
  return LINK_KEYS.every((k) => linkValue(a, k) === linkValue(b, k));
}

/**
 * 对比新旧链接列表（按 name 作为唯一键），生成增/删/改/重命名摘要。
 * 仅改名（除 name 外字段全等）归为「重命名」，而不误判为「删除+新增」。
 * 返回：summary（一句话摘要）与 detail（含新增/删除/重命名/修改明细的 JSON 字符串）
 */
export function diffLinks(
  before: LinkItem[],
  after: LinkItem[]
): { summary: string; detail: string } {
  const beforeMap = new Map(before.map((b) => [b.name, b]));
  const afterMap = new Map(after.map((a) => [a.name, a]));

  const added: LinkItem[] = [];
  const removed: LinkItem[] = [];
  const modified: { before: LinkItem; after: LinkItem }[] = [];
  const renamed: { before: LinkItem; after: LinkItem }[] = [];

  after.forEach((a) => {
    if (!beforeMap.has(a.name)) added.push(a);
  });
  before.forEach((b) => {
    if (!afterMap.has(b.name)) removed.push(b);
  });

  // 重命名识别：被删条目与新增条目除 name 外字段全等 → 视为一次重命名，而非删+增。
  // 启发式限制（已知 tradeoff）：真正的"删除 A + 新增 B（除 name 外字段全等）"也会被
  // 归为重命名（见 tests/diff-links.test.ts）；需要精确语义时应改用 id 优先匹配。
  for (const r of [...removed]) {
    const idx = added.findIndex((a) => a.name !== r.name && linksEqualExceptName(a, r));
    if (idx >= 0) {
      renamed.push({ before: r, after: added[idx] });
      removed.splice(removed.indexOf(r), 1);
      added.splice(idx, 1);
    }
  }

  // 修改识别：name 未变，仅比较其它字段
  before.forEach((b) => {
    const a = afterMap.get(b.name);
    if (a && b.name === a.name && !linksEqualExceptName(a, b)) {
      modified.push({ before: b, after: a });
    }
  });

  const parts: string[] = [];
  if (renamed.length) parts.push(`重命名 ${renamed.length} 条`);
  if (added.length) parts.push(`新增 ${added.length} 条`);
  if (removed.length) parts.push(`删除 ${removed.length} 条`);
  if (modified.length) parts.push(`修改 ${modified.length} 条`);
  const summary = parts.length ? parts.join("，") : "无变化";

  const detail = JSON.stringify({
    added: added.map((a) => ({ name: a.name, icon: a.icon, url: a.url })),
    removed: removed.map((r) => ({ name: r.name })),
    renamed: renamed.map((r) => ({
      from: r.before.name,
      to: r.after.name,
    })),
    modified: modified.map((m) => ({
      name: m.before.name,
      changed: LINK_KEYS.reduce<Record<string, unknown>>((acc, key) => {
        if (linkValue(m.before, key) !== linkValue(m.after, key)) {
          acc[key] = { from: linkValue(m.before, key), to: linkValue(m.after, key) };
        }
        return acc;
      }, {}),
    })),
  });

  return { summary, detail };
}

// 从 profileSchema 派生字段清单，避免手工维护与 schema 漂移
const PROFILE_FIELDS = Object.keys(profileSchema.shape);
// 敏感字段：日志中仅记录"已配置/未配置"，不记录真实值
const SENSITIVE_PROFILE_FIELDS = new Set([
  "amapSecretKey",
  "txWeatherSk",
  // HTML/脚本类长内容（admin 录入）：变更日志只记"已配置/未配置"，
  // 避免把完整统计代码、head 脚本或页脚 HTML 全文（可达上万字符）写入 operationLog detail
  "analyticsScript",
  "headScript",
  "siteFooterHtml",
]);

/** 返回实际发生变化（旧值≠新值）的 Profile 字段名列表 */
export function getChangedProfileFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): string[] {
  return PROFILE_FIELDS.filter((f) => (before[f] ?? "") !== (after[f] ?? ""));
}

/**
 * 对比 Profile 变更字段，返回摘要与明细。
 * 说明：字段清单由 profileSchema 派生；敏感密钥仅记录"已配置/未配置"，
 * 不把真实值写入日志（防泄露）。
 */
export function diffProfile(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): { summary: string; detail: string } {
  const changed = getChangedProfileFields(before, after);
  if (changed.length === 0) return { summary: "无变化", detail: "{}" };

  const detail = JSON.stringify(
    changed.reduce<Record<string, unknown>>((acc, f) => {
      if (SENSITIVE_PROFILE_FIELDS.has(f)) {
        acc[f] = { from: before[f] ? "已配置" : "未配置", to: after[f] ? "已配置" : "未配置" };
      } else {
        acc[f] = { from: before[f] ?? "", to: after[f] ?? "" };
      }
      return acc;
    }, {})
  );
  return { summary: `修改字段：${changed.join("、")}`, detail };
}
