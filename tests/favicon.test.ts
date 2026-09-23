import { describe, expect, it } from "vitest";
import { extractHostname, faviconCandidates } from "@/lib/favicon";

/**
 * 图标探测的第一道关卡：从用户输入里安全地取出主机名。
 * 取不出来的输入必须直接拒绝，避免把任意字符串拼进候选 URL。
 */
describe("extractHostname（提取主机名）", () => {
  it.each([
    ["github.com", "github.com"],
    ["GitHub.COM", "github.com"],
    ["github.com/sxlb", "github.com"],
    ["https://github.com/sxlb", "github.com"],
    ["http://github.com/sxlb/repo", "github.com"],
    ["https://www.github.com", "www.github.com"],
    ["https://example.com:8080/path", "example.com"],
    ["  example.com  ", "example.com"],
  ])("从 %s 提取出 %s", (input, expected) => {
    expect(extractHostname(input)).toBe(expected);
  });

  it.each([
    ["", "空输入"],
    ["   ", "纯空白"],
    ["hello world.com", "含空格"],
    ["localhost", "无点号（内网名）"],
    [".com", "以点开头"],
    ["example.com.", "以点结尾"],
    ["foo..bar", "连续点号"],
  ])("拒绝 %s（%s）", (input) => {
    expect(extractHostname(input)).toBeNull();
  });
});

describe("faviconCandidates（候选源优先级）", () => {
  it("首位是站点自身的 favicon.ico，最权威", () => {
    const list = faviconCandidates("github.com");
    expect(list[0].url).toBe("https://github.com/favicon.ico");
  });

  it("Google favicon 仅作为最后的兜底（国内可达性差）", () => {
    const list = faviconCandidates("github.com");
    expect(list[list.length - 1].url).toContain("google.com/s2/favicons");
    expect(list[list.length - 1].url).toContain("domain=github.com");
  });

  it("所有候选地址都带上目标主机名，且每个都有来源说明", () => {
    const list = faviconCandidates("sxlb.xyz");
    expect(list.length).toBeGreaterThanOrEqual(3);
    for (const item of list) {
      expect(item.url).toContain("sxlb.xyz");
      expect(item.source.length).toBeGreaterThan(0);
    }
  });
});
