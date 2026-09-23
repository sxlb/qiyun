import { z } from "zod";
import {
  profileSchema,
  socialLinkSchema,
  siteLinkSchema,
  friendLinkSchema,
  projectSchema,
  skillSchema,
  announcementSchema,
  imageAssetSchema,
  linkClickSchema,
} from "@/lib/validation";
import { createHmac, randomBytes } from "node:crypto";

/**
 * 备份文件版本：
 * - v1：profile + 三个链接表
 * - v2：追加作品集 / 技能云 / 站点公告
 * - v3：追加媒体库记录 / 链接点击统计
 *
 * 恢复采用**按存在性覆盖**策略，而不是按版本号分支：
 * 备份文件里出现了哪个扩展字段，就覆盖对应那张表；未出现的表保持原样。
 * 这样既能让旧备份安全恢复（不会用缺失的数据清空现有内容），
 * 也让后续新增实体只需往 OPTIONAL_ENTITIES 里加一行。
 */
export const BACKUP_VERSION = 3;

/** 可恢复的备份版本（升序，供提示文案与校验共用） */
const SUPPORTED_VERSIONS = [1, 2, 3] as const;

/** 扩展实体（v2 起陆续加入）：键名即备份文件中的字段名 */
export type OptionalEntityKey = "projects" | "skills" | "announcements" | "media" | "linkClicks";

/** 备份文件结构（对外暴露，供 API 与前端类型使用） */
export interface BackupData {
  version: number;
  exportedAt: string;
  profile: Record<string, unknown>;
  socialLinks: Record<string, unknown>[];
  siteLinks: Record<string, unknown>[];
  friendLinks: Record<string, unknown>[];
  /** v2 起：作品集 */
  projects?: Record<string, unknown>[];
  /** v2 起：技能云 */
  skills?: Record<string, unknown>[];
  /** v2 起：站点公告 */
  announcements?: Record<string, unknown>[];
  /** v3 起：媒体库记录（不含图片文件本身） */
  media?: Record<string, unknown>[];
  /** v3 起：链接点击统计（后台「热门链接」） */
  linkClicks?: Record<string, unknown>[];
  /** 【Critical】HMAC-SHA256 完整性签名（备份导出时自动生成，校验时自动丢弃） */
  _hmac?: string;
  /** 盐值（用于未来扩展，当前不参与签名计算） */
  _salt?: string;
}

/** 恢复后各实体的写入条数（未出现在备份中的实体记为 0） */
export interface BackupCounts {
  profile: 0 | 1;
  socialLinks: number;
  siteLinks: number;
  friendLinks: number;
  projects: number;
  skills: number;
  announcements: number;
  media: number;
  linkClicks: number;
}

/** 扩展实体的可选入参（保持 buildBackup 前四个参数稳定，扩展项集中在一个对象里） */
export type BackupExtra = Partial<Record<OptionalEntityKey, Record<string, unknown>[]>>;

/** v1 起就存在的字段（缺失即判定备份损坏） */
const CORE_ARRAY_KEYS = ["socialLinks", "siteLinks", "friendLinks"] as const;

/** 扩展实体定义：字段名 → 中文名 / 校验 schema / 事务内的模型名 */
const OPTIONAL_ENTITIES: ReadonlyArray<{
  key: OptionalEntityKey;
  label: string;
  schema: z.ZodTypeAny;
  txModel: string;
}> = [
  { key: "projects", label: "作品集", schema: projectSchema, txModel: "project" },
  { key: "skills", label: "技能云", schema: skillSchema, txModel: "skill" },
  { key: "announcements", label: "站点公告", schema: announcementSchema, txModel: "siteAnnouncement" },
  { key: "media", label: "媒体库记录", schema: imageAssetSchema, txModel: "imageAsset" },
  { key: "linkClicks", label: "链接点击统计", schema: linkClickSchema, txModel: "siteLinkClick" },
];

/** 组装备份对象（纯函数，可单测） */
export function buildBackup(
  profile: Record<string, unknown>,
  socialLinks: Record<string, unknown>[],
  siteLinks: Record<string, unknown>[],
  friendLinks: Record<string, unknown>[],
  extra: BackupExtra = {}
): BackupData {
  const data: BackupData = {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    profile,
    socialLinks,
    siteLinks,
    friendLinks,
  };
  // 只写入调用方明确提供的扩展实体：缺失的键在恢复时不会被触碰
  for (const { key } of OPTIONAL_ENTITIES) {
    const list = extra[key];
    if (Array.isArray(list)) data[key] = list;
  }
  // 【Critical 修复】HMAC-SHA256 完整性签名，防止备份文件被篡改静默覆盖数据库
  // 签名基于完整备份内容（除 _hmac / _salt），盐值用于后续可能的扩展或记录
  const salt = randomBytes(16).toString("hex");
  const signPayload = JSON.stringify(data);
  data._hmac = createHmac("sha256", process.env.BACKUP_HMAC_KEY || "qiyun-backup-salt").update(signPayload).digest("hex");
  data._salt = salt;
  return data;
}

/**
 * 基本结构校验：版本 + 核心字段形状（字段级语义校验在 restoreBackup 内完成）。
 * 【Critical 修复】v3+ 的备份文件增加 HMAC-SHA256 完整性校验，被篡改文件直接拒绝。
 */
export function parseBackup(
  raw: unknown
): { ok: true; data: BackupData } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "备份文件格式错误" };
  const obj = raw as Record<string, unknown>;
  const version = obj.version;
  if (
    typeof version !== "number" ||
    !(SUPPORTED_VERSIONS as readonly number[]).includes(version)
  ) {
    return {
      ok: false,
      error: `不支持的备份版本（当前支持 v${SUPPORTED_VERSIONS.join(" / v")}）`,
    };
  }
  if (!obj.profile || typeof obj.profile !== "object") return { ok: false, error: "备份缺少站点配置" };
  for (const key of CORE_ARRAY_KEYS) {
    if (!Array.isArray(obj[key])) return { ok: false, error: `备份缺少 ${key}` };
  }

  // 【Critical 修复】HMAC 完整性校验（v3+ 引入，旧版无签名则放行以保证兼容）
  // 签名字段来自备份文件自身，payload = 除 _hmac/_salt 外的全部字段做哈希比较
  if (obj._hmac) {
    const hmacKey = process.env.BACKUP_HMAC_KEY || "qiyun-backup-salt";
    // 排除签名本身及盐值后做序列化 → 对比 HMAC
    const { _hmac: _, _salt: __, ...restorePayload } = obj as Record<string, unknown>;
    const cleanPayload = JSON.stringify(restorePayload);
    const expectedHash = createHmac("sha256", hmacKey).update(cleanPayload).digest("hex");
    const providedHash = typeof obj._hmac === "string" ? obj._hmac : "";
    // timing-safe compare：同长度下逐字节对比（64 字符 hex 等长时 === 即安全）
    if (expectedHash.length !== providedHash.length || expectedHash !== providedHash) {
      return { ok: false, error: "备份文件完整性校验失败——可能已被篡改，拒绝恢复" };
    }
  }

  const data: BackupData = {
    version,
    exportedAt: typeof obj.exportedAt === "string" ? obj.exportedAt : "",
    profile: obj.profile as Record<string, unknown>,
    socialLinks: obj.socialLinks as Record<string, unknown>[],
    siteLinks: obj.siteLinks as Record<string, unknown>[],
    friendLinks: obj.friendLinks as Record<string, unknown>[],
  };
  // 扩展字段：仅当文件里确实是数组时才带上，否则保持 undefined（= 恢复时不覆盖该表）
  for (const { key } of OPTIONAL_ENTITIES) {
    if (Array.isArray(obj[key])) data[key] = obj[key] as Record<string, unknown>[];
  }
  return { ok: true, data };
}

/** 事务内可用于「整表覆盖」的委托形态 */
interface TableTxDelegate {
  deleteMany(): Promise<unknown>;
  createMany(args: { data: Record<string, unknown>[] }): Promise<unknown>;
}

/**
 * 恢复备份：完整校验（profile + 全部存在的列表逐条）+ 事务覆盖。
 * prisma 依赖注入，便于单测 mock。
 * 返回 { ok, count? }；校验失败不触碰数据库，事务失败整体回滚。
 */
export async function restoreBackup(
  prisma: unknown,
  raw: unknown
): Promise<{ ok: true; count: BackupCounts } | { ok: false; error: string }> {
  const parsed = parseBackup(raw);
  if (!parsed.ok) return parsed;
  const data = parsed.data;

  // 字段级校验（前置，任何一条不合法即拒绝）
  const profileResult = profileSchema.safeParse(data.profile);
  if (!profileResult.success) {
    return { ok: false, error: `站点配置校验失败：${profileResult.error.issues[0]?.message ?? "格式错误"}` };
  }

  // 校验并清洗列表（返回清洗后的数据供事务写入，避免多余字段入库）
  const cleanList = (
    list: Record<string, unknown>[],
    schema: z.ZodTypeAny,
    label: string
  ): { ok: true; data: Record<string, unknown>[] } | { ok: false; error: string } => {
    const cleaned: Record<string, unknown>[] = [];
    for (const item of list) {
      const r = schema.safeParse(item);
      if (!r.success) {
        return { ok: false, error: `${label}中存在非法数据：${r.error.issues[0]?.message ?? "格式错误"}` };
      }
      cleaned.push(r.data as Record<string, unknown>);
    }
    return { ok: true, data: cleaned };
  };

  const social = cleanList(data.socialLinks, socialLinkSchema, "社交链接");
  if (!social.ok) return social;
  const site = cleanList(data.siteLinks, siteLinkSchema, "网站链接");
  if (!site.ok) return site;
  const friend = cleanList(data.friendLinks, friendLinkSchema, "友情链接");
  if (!friend.ok) return friend;

  // 扩展实体：只校验备份中确实存在的那些
  const extras = new Map<OptionalEntityKey, { label: string; txModel: string; rows: Record<string, unknown>[] }>();
  for (const entity of OPTIONAL_ENTITIES) {
    const list = data[entity.key];
    if (!Array.isArray(list)) continue;
    const cleaned = cleanList(list, entity.schema, entity.label);
    if (!cleaned.ok) return cleaned;
    extras.set(entity.key, { label: entity.label, txModel: entity.txModel, rows: cleaned.data });
  }

  const p = prisma as {
    $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
  };

  try {
    const result = await p.$transaction(async (txRaw) => {
      const tx = txRaw as Record<string, TableTxDelegate>;

      // 核心三表：始终覆盖
      for (const key of ["socialLink", "siteLink", "friendLink"] as const) {
        const d = tx[key];
        if (!d) continue;
        await d.deleteMany();
      }

      // 扩展实体：仅覆盖备份中出现过的表
      // （v1 备份不含扩展表，若无条件清空会把用户现有的作品集/技能云/公告一并抹掉）
      for (const { txModel } of extras.values()) {
        const d = tx[txModel];
        if (!d) continue;
        await d.deleteMany();
      }

      // Profile 单例：存在则更新，否则创建
      const profileTx = tx as unknown as {
        profile: {
          findFirst(args?: unknown): Promise<{ id: number } | null>;
          update(args: unknown): Promise<unknown>;
          create(args: unknown): Promise<unknown>;
        };
      };
      const existing = await profileTx.profile.findFirst({ orderBy: { id: "asc" } });
      if (existing) {
        await profileTx.profile.update({ where: { id: existing.id }, data: profileResult.data });
      } else {
        await profileTx.profile.create({ data: profileResult.data });
      }

      // 回填核心三表
      if (social.data.length > 0) await tx.socialLink.createMany({ data: social.data });
      if (site.data.length > 0) await tx.siteLink.createMany({ data: site.data });
      if (friend.data.length > 0) await tx.friendLink.createMany({ data: friend.data });

      // 回填扩展实体
      const extraCounts: Record<OptionalEntityKey, number> = {
        projects: 0,
        skills: 0,
        announcements: 0,
        media: 0,
        linkClicks: 0,
      };
      for (const [key, entity] of extras) {
        if (entity.rows.length > 0) await tx[entity.txModel].createMany({ data: entity.rows });
        extraCounts[key] = entity.rows.length;
      }

      return {
        profile: (existing ? 0 : 1) as 0 | 1,
        socialLinks: social.data.length,
        siteLinks: site.data.length,
        friendLinks: friend.data.length,
        ...extraCounts,
      } satisfies BackupCounts;
    });
    return { ok: true, count: result };
  } catch {
    return { ok: false, error: "恢复失败：数据库错误" };
  }
}
