import { describe, it, expect, vi } from "vitest";
import { buildBackup, parseBackup, restoreBackup, BACKUP_VERSION } from "@/lib/backup";

const profile = { nickname: "测试", bio: "hi", customFontEnabled: false };
const socialLinks = [{ name: "GitHub", icon: "github", url: "https://github.com", tip: "", sort: 0 }];
const siteLinks = [{ name: "博客", icon: "globe", url: "https://example.com", sort: 0 }];
const friendLinks = [{ name: "友链", url: "https://example.com", icon: "", description: "", sort: 0 }];
const projects = [
  { title: "作品", description: "", url: "", image: "", tags: "", featured: false, enabled: true, sort: 0 },
];
const skills = [{ name: "TypeScript", level: 80, icon: "", sort: 0 }];
const announcements = [
  { title: "公告", content: "正文", pinned: false, enabled: true, sort: 0, startAt: null, endAt: null },
];
const media = [
  { url: "/api/uploads/file/a.png", fileName: "a.png", mimeType: "image/png", size: 1234, width: 10, height: 20, usage: "avatar" },
];
const linkClicks = [{ linkId: 1, name: "甲站", url: "https://a.example.com", count: 7 }];

/** 完整的扩展实体集合（v3） */
const fullExtra = { projects, skills, announcements, media, linkClicks };

/** 事务内需要覆盖的全部委托 */
const TX_MODELS = [
  "socialLink",
  "siteLink",
  "friendLink",
  "project",
  "skill",
  "siteAnnouncement",
  "imageAsset",
  "siteLinkClick",
] as const;

type TxModel = (typeof TX_MODELS)[number];

/** 构造覆盖全部实体的 mock prisma（$transaction 直接执行回调并传入同一份 tx） */
function makePrisma() {
  const tx = {} as Record<TxModel, { deleteMany: ReturnType<typeof vi.fn>; createMany: ReturnType<typeof vi.fn> }> & {
    profile: { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  };
  for (const m of TX_MODELS) {
    tx[m] = { deleteMany: vi.fn(), createMany: vi.fn() };
  }
  tx.profile = { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn(), create: vi.fn() };
  const prisma = {
    ...tx,
    $transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
  };
  return { prisma, tx };
}

/** v1 旧格式：仅核心四类 */
const legacyV1 = {
  version: 1,
  exportedAt: "2026-01-01T00:00:00.000Z",
  profile,
  socialLinks,
  siteLinks,
  friendLinks,
};

describe("buildBackup", () => {
  it("组装带版本号与导出时间的备份对象", () => {
    const b = buildBackup(profile as never, socialLinks, siteLinks, friendLinks);
    expect(b.version).toBe(BACKUP_VERSION);
    expect(typeof b.exportedAt).toBe("string");
    expect(b.profile.nickname).toBe("测试");
    expect(b.socialLinks).toHaveLength(1);
  });

  it("未提供扩展实体时，对应键不存在（而非空数组）", () => {
    const b = buildBackup(profile as never, socialLinks, siteLinks, friendLinks);
    // 关键：只有"确实存在"才写入，恢复时才能正确判断哪些表需要覆盖
    expect(b).not.toHaveProperty("projects");
    expect(b).not.toHaveProperty("media");
    expect(b).not.toHaveProperty("linkClicks");
  });

  it("提供扩展实体时原样写入（覆盖作品集/技能云/公告/媒体库/点击统计）", () => {
    const b = buildBackup(profile as never, socialLinks, siteLinks, friendLinks, fullExtra);
    expect(b.projects).toHaveLength(1);
    expect(b.skills).toHaveLength(1);
    expect(b.announcements).toHaveLength(1);
    expect(b.media).toHaveLength(1);
    expect(b.linkClicks).toHaveLength(1);
  });

  it("空数组视为「明确提供了该实体」——恢复时会清空对应表", () => {
    const b = buildBackup(profile as never, socialLinks, siteLinks, friendLinks, { projects: [] });
    expect(b.projects).toEqual([]);
  });
});

describe("parseBackup", () => {
  it("合法备份通过", () => {
    expect(parseBackup(buildBackup(profile as never, socialLinks, siteLinks, friendLinks)).ok).toBe(true);
  });

  it("v1 旧备份可解析，且扩展字段保持 undefined（= 恢复时不覆盖）", () => {
    const result = parseBackup(legacyV1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.version).toBe(1);
      expect(result.data.projects).toBeUndefined();
      expect(result.data.media).toBeUndefined();
      expect(result.data.linkClicks).toBeUndefined();
    }
  });

  it("v3 备份保留全部扩展字段", () => {
    const b = buildBackup(profile as never, socialLinks, siteLinks, friendLinks, fullExtra);
    const result = parseBackup(b);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.media).toHaveLength(1);
      expect(result.data.linkClicks).toHaveLength(1);
    }
  });

  it("不支持的版本被拒绝", () => {
    const b = buildBackup(profile as never, socialLinks, siteLinks, friendLinks);
    expect(parseBackup({ ...b, version: 99 }).ok).toBe(false);
    expect(parseBackup({ ...b, version: "3" }).ok).toBe(false);
  });

  it("结构缺失被拒绝", () => {
    expect(parseBackup({ version: 3 }).ok).toBe(false);
    expect(parseBackup({ version: 3, profile: {}, siteLinks: [], friendLinks: [] }).ok).toBe(false);
  });
});

describe("restoreBackup", () => {
  it("校验失败时不调用任何数据库操作", async () => {
    const { prisma } = makePrisma();
    const bad = { ...legacyV1, profile: { nickname: "" } };
    const result = await restoreBackup(prisma, bad);
    expect(result.ok).toBe(false);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("v3 备份覆盖全部扩展表，并统计各表条数", async () => {
    const { prisma, tx } = makePrisma();
    const b = buildBackup(profile as never, socialLinks, siteLinks, friendLinks, fullExtra);

    const result = await restoreBackup(prisma, b);

    expect(result.ok).toBe(true);
    for (const m of ["project", "skill", "siteAnnouncement", "imageAsset", "siteLinkClick"] as const) {
      expect(tx[m].deleteMany).toHaveBeenCalledTimes(1);
      expect(tx[m].createMany).toHaveBeenCalledTimes(1);
    }
    if (result.ok) {
      expect(result.count.projects).toBe(1);
      expect(result.count.skills).toBe(1);
      expect(result.count.announcements).toBe(1);
      expect(result.count.media).toBe(1);
      expect(result.count.linkClicks).toBe(1);
    }
  });

  it("v1 旧备份不触碰任何扩展表（避免误删现有内容）", async () => {
    const { prisma, tx } = makePrisma();
    const result = await restoreBackup(prisma, legacyV1);

    expect(result.ok).toBe(true);
    for (const m of ["project", "skill", "siteAnnouncement", "imageAsset", "siteLinkClick"] as const) {
      expect(tx[m].deleteMany).not.toHaveBeenCalled();
      expect(tx[m].createMany).not.toHaveBeenCalled();
    }
    if (result.ok) {
      expect(result.count.projects).toBe(0);
      expect(result.count.media).toBe(0);
      expect(result.count.linkClicks).toBe(0);
    }
  });

  it("部分扩展实体：只覆盖备份中出现的那张表", async () => {
    const { prisma, tx } = makePrisma();
    // 只带媒体库与点击统计，不含作品集/技能云/公告
    const b = buildBackup(profile as never, socialLinks, siteLinks, friendLinks, { media, linkClicks });

    const result = await restoreBackup(prisma, b);

    expect(result.ok).toBe(true);
    expect(tx.imageAsset.deleteMany).toHaveBeenCalledTimes(1);
    expect(tx.siteLinkClick.deleteMany).toHaveBeenCalledTimes(1);
    expect(tx.project.deleteMany).not.toHaveBeenCalled();
    expect(tx.skill.deleteMany).not.toHaveBeenCalled();
    expect(tx.siteAnnouncement.deleteMany).not.toHaveBeenCalled();
    if (result.ok) {
      expect(result.count.media).toBe(1);
      expect(result.count.linkClicks).toBe(1);
      expect(result.count.projects).toBe(0);
    }
  });

  it("扩展数据非法时拒绝，且不写库", async () => {
    const { prisma } = makePrisma();
    const b = buildBackup(prisma as never, socialLinks, siteLinks, friendLinks, {
      // 作品标题必填，空标题应被拒绝
      projects: [{ title: "", description: "", url: "", image: "", tags: "", featured: false, enabled: true, sort: 0 }],
    });
    const result = await restoreBackup(prisma, b);
    expect(result.ok).toBe(false);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("媒体库记录缺少 url 时拒绝（url 为唯一键，不能为空）", async () => {
    const { prisma } = makePrisma();
    const b = buildBackup(prisma as never, socialLinks, siteLinks, friendLinks, {
      media: [{ url: "", fileName: "a.png" }],
    });
    const result = await restoreBackup(prisma, b);
    expect(result.ok).toBe(false);
  });

  it("点击统计 linkId 非正整数时拒绝", async () => {
    const { prisma } = makePrisma();
    const b = buildBackup(prisma as never, socialLinks, siteLinks, friendLinks, {
      linkClicks: [{ linkId: 0, name: "x" }],
    });
    const result = await restoreBackup(prisma, b);
    expect(result.ok).toBe(false);
  });

  it("公告时间字段缺省时按 null 兜底通过", async () => {
    const { prisma } = makePrisma();
    const b = buildBackup(prisma as never, socialLinks, siteLinks, friendLinks, {
      announcements: [{ title: "T", content: "C", pinned: false, enabled: true, sort: 0 }],
    });
    const result = await restoreBackup(prisma, b);
    expect(result.ok).toBe(true);
  });
});
