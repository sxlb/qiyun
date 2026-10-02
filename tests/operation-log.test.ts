import { describe, it, expect } from "vitest";
import { diffProfile, diffLinks } from "@/lib/server";

describe("diffProfile（Profile 配置变更对比）", () => {
  it("检测新增字段（useRandomAvatar / welcome 系列）的变更", () => {
    const before = {
      useRandomAvatar: false,
      welcomeEnabled: true,
      welcomeIndex: 0,
      welcomeMessages: '["a"]',
      nickname: "旧名",
    };
    const after = {
      useRandomAvatar: true,
      welcomeEnabled: false,
      welcomeIndex: 2,
      welcomeMessages: '["a","b","c"]',
      nickname: "旧名",
    };
    const { summary, detail } = diffProfile(before, after);
    expect(summary).toContain("useRandomAvatar");
    expect(summary).toContain("welcomeEnabled");
    expect(summary).toContain("welcomeIndex");
    expect(summary).toContain("welcomeMessages");
    expect(summary).not.toContain("nickname"); // 未变更的字段不出现在摘要中
    const parsed = JSON.parse(detail);
    expect(parsed.useRandomAvatar).toEqual({ from: false, to: true });
    expect(parsed.welcomeIndex).toEqual({ from: 0, to: 2 });
  });

  it("未变更时返回『无变化』", () => {
    const base = { nickname: "sxlb", welcomeEnabled: true };
    const { summary, detail } = diffProfile(base, { ...base, createdAt: "2026-01-01" });
    expect(summary).toBe("无变化");
    expect(detail).toBe("{}");
  });
});

describe("diffLinks（链接列表变更对比）", () => {
  const before = [
    { id: 1, name: "GitHub", icon: "github", url: "https://a", tip: "x", sort: 0 },
    { id: 2, name: "邮箱", icon: "mail", url: "https://b", tip: "", sort: 1 },
  ];
  const after = [
    { id: 1, name: "GitHub", icon: "github", url: "https://a", tip: "x", sort: 0 },
    { name: "博客", icon: "globe", url: "https://c", tip: "", sort: 2 },
  ];

  it("识别新增与删除", () => {
    const { summary } = diffLinks(before, after);
    expect(summary).toContain("新增 1 条");
    expect(summary).toContain("删除 1 条");
  });

  it("识别字段修改并记录前后值", () => {
    const modified = [
      { id: 1, name: "GitHub", icon: "github", url: "https://new", tip: "x", sort: 0 },
    ];
    const { summary, detail } = diffLinks(
      [{ id: 1, name: "GitHub", icon: "github", url: "https://old", tip: "x", sort: 0 }],
      modified
    );
    expect(summary).toContain("修改 1 条");
    const parsed = JSON.parse(detail);
    expect(parsed.modified[0].changed.url).toEqual({ from: "https://old", to: "https://new" });
  });
});
