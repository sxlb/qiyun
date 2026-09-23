import { describe, it, expect } from "vitest";
import {
  siteLinkSchema,
  socialLinkSchema,
  friendLinkSchema,
  skillSchema,
  projectSchema,
  announcementBatchSchema,
} from "@/lib/validation";

describe("siteLinkSchema（网站链接）", () => {
  it("接受 http/https/mailto/tel 链接", () => {
    for (const url of [
      "https://example.com",
      "http://example.com",
      "mailto:hi@example.com",
      "tel:10086",
    ]) {
      expect(siteLinkSchema.safeParse({ name: "博客", icon: "book-open", url }).success).toBe(true);
    }
  });

  it("接受 music: 伪协议（触发页面音乐播放器）", () => {
    const result = siteLinkSchema.safeParse({ name: "音乐", icon: "music", url: "music:" });
    expect(result.success).toBe(true);
  });

  it("拒绝非法协议与空链接", () => {
    expect(siteLinkSchema.safeParse({ name: "x", icon: "link", url: "ftp://example.com" }).success).toBe(false);
    expect(siteLinkSchema.safeParse({ name: "x", icon: "link", url: "javascript:alert(1)" }).success).toBe(false);
    expect(siteLinkSchema.safeParse({ name: "x", icon: "link", url: "" }).success).toBe(false);
  });
});

describe("socialLinkSchema（社交链接）", () => {
  it("不接受 music: 伪协议（社交链接无此语义）", () => {
    expect(socialLinkSchema.safeParse({ name: "音乐", icon: "music", url: "music:" }).success).toBe(false);
  });
});

describe("图标字段支持网络图片（MediaPicker 产出的值）", () => {
  const imageIcons = [
    "https://www.google.com/s2/favicons?domain=github.com&sz=64",
    "random:nature",
    "unsplash:nature", // 旧前缀，保留兼容
    "lucide:github",
    "book-open",
    "icon-github",
  ];

  it("网站链接接受外链图片 / unsplash / lucide / iconfont 图标", () => {
    for (const icon of imageIcons) {
      expect(siteLinkSchema.safeParse({ name: "博客", icon, url: "https://example.com" }).success).toBe(true);
    }
  });

  it("社交链接接受外链图片 / unsplash 图标", () => {
    for (const icon of imageIcons) {
      expect(socialLinkSchema.safeParse({ name: "微博", icon, url: "https://example.com" }).success).toBe(true);
    }
  });

  it("网站/社交链接拒绝空图标与含非法字符的图标", () => {
    expect(siteLinkSchema.safeParse({ name: "x", icon: "", url: "https://example.com" }).success).toBe(false);
    expect(socialLinkSchema.safeParse({ name: "x", icon: "bad icon!", url: "https://example.com" }).success).toBe(false);
    expect(siteLinkSchema.safeParse({ name: "x", icon: "javascript:alert(1)", url: "https://example.com" }).success).toBe(false);
  });

  it("友情链接接受外链 Logo / unsplash / 图标名，拒绝非法值", () => {
    for (const icon of imageIcons) {
      expect(friendLinkSchema.safeParse({ name: "友链", url: "https://example.com", icon }).success).toBe(true);
    }
    // icon 可空（默认空字符串）
    expect(friendLinkSchema.safeParse({ name: "友链", url: "https://example.com" }).success).toBe(true);
    expect(friendLinkSchema.safeParse({ name: "友链", url: "https://example.com", icon: "bad icon!" }).success).toBe(false);
  });

  it("技能接受外链图标 / unsplash / lucide 图标名，拒绝非法值", () => {
    for (const icon of imageIcons) {
      expect(skillSchema.safeParse({ name: "TypeScript", icon }).success).toBe(true);
    }
    expect(skillSchema.safeParse({ name: "TypeScript" }).success).toBe(true);
    expect(skillSchema.safeParse({ name: "TypeScript", icon: "bad icon!" }).success).toBe(false);
  });

  it("作品封面图接受 unsplash 随机图与媒体库路径，url 仍仅限外链/媒体库", () => {
    expect(projectSchema.safeParse({ title: "项目", image: "unsplash:city" }).success).toBe(true);
    expect(projectSchema.safeParse({ title: "项目", image: "https://example.com/a.png" }).success).toBe(true);
    expect(projectSchema.safeParse({ title: "项目", image: "/api/uploads/a.png" }).success).toBe(true);
    expect(projectSchema.safeParse({ title: "项目", image: "ftp://example.com/a.png" }).success).toBe(false);
    // url 字段不允许 unsplash（仅图片字段支持随机图）
    expect(projectSchema.safeParse({ title: "项目", url: "unsplash:city" }).success).toBe(false);
  });
});

describe("announcementBatchSchema（公告批量保存）", () => {
  it("接受空数组（删除全部公告的提交）", () => {
    expect(announcementBatchSchema.safeParse([]).success).toBe(true);
  });

  it("接受混合：新增无 id + 更新带 id", () => {
    const payload = [
      { title: "新公告", content: "欢迎", pinned: false, enabled: true, sort: 0 },
      { id: 5, title: "旧公告", content: "更新", pinned: true, enabled: true, sort: 1 },
    ];
    const result = announcementBatchSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("拒绝缺 title 或缺 content 的项", () => {
    expect(announcementBatchSchema.safeParse([{ content: "缺标题", sort: 0 }]).success).toBe(false);
    expect(announcementBatchSchema.safeParse([{ title: "缺内容", sort: 0 }]).success).toBe(false);
  });

  it("拒绝非法 id（非正整数）", () => {
    expect(
      announcementBatchSchema.safeParse([{ id: -1, title: "x", content: "y" }]).success
    ).toBe(false);
  });
});
