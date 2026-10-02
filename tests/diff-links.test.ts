import { describe, it, expect } from "vitest";
import { diffLinks, type LinkItem } from "@/lib/server";

const mk = (name: string, extra: Partial<LinkItem> = {}): LinkItem => ({
  name,
  icon: "link",
  url: "https://a.com",
  tip: "",
  description: "",
  sort: 0,
  ...extra,
});

describe("diffLinks（重命名识别）", () => {
  it("仅改名时归为『重命名』而非『删除+新增』", () => {
    const before = [mk("旧名")];
    const after = [mk("新名")];
    const { summary, detail } = diffLinks(before, after);
    expect(summary).toContain("重命名 1 条");
    expect(summary).not.toContain("新增");
    expect(summary).not.toContain("删除");
    expect(detail).toContain("新名");
  });

  it("真正的新增/删除/修改仍被正常识别", () => {
    const before = [mk("keep"), mk("del")];
    // 注意：为了真正制造"删除+新增"，add 的 url 需与 del 不同，
    // 否则会被「重命名」启发式正确吞并为重命名（二者除 name 外全等，无法与改名区分）。
    const after = [mk("keep", { sort: 3 }), mk("add", { url: "https://b.com" })];
    const { summary } = diffLinks(before, after);
    expect(summary).toContain("删除 1 条");
    expect(summary).toContain("新增 1 条");
    expect(summary).toContain("修改 1 条");
  });
});