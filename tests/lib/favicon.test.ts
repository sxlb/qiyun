import { describe, expect, it } from "vitest";
import { extractHostname, extractIconHrefs, faviconCandidates } from "@/lib/favicon";

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
    const list = faviconCandidates("example.com");
    expect(list.length).toBeGreaterThanOrEqual(3);
    for (const item of list) {
      expect(item.url).toContain("example.com");
      expect(item.source.length).toBeGreaterThan(0);
    }
  });
});

/**
 * 页面声明的图标：很多站点（尤其是把图标放 CDN/OSS 的博客）根目录没有 favicon.ico，
 * 只在 HTML 的 <link rel="icon"> 里指向别处。解析不到位就会误判成「站点没有图标」。
 */
describe("extractIconHrefs（解析页面声明的图标）", () => {
  const BASE = "https://blog.example.com/";

  it("解析 rel=icon / shortcut icon / apple-touch-icon，保持声明顺序", () => {
    const html = `
      <head>
        <link rel="icon" type="image/ico" href="https://cdn.example.com/logo.jpg">
        <link rel="shortcut icon" href="/favicon.png">
        <link rel="apple-touch-icon" sizes="180x180" href="/apple.png">
      </head>`;
    expect(extractIconHrefs(html, BASE)).toEqual([
      "https://cdn.example.com/logo.jpg",
      "https://blog.example.com/favicon.png",
      "https://blog.example.com/apple.png",
    ]);
  });

  it("忽略非图标 link 与无关标签", () => {
    const html = `<link rel="stylesheet" href="/a.css"><link rel="preload" as="image" href="/x.png"><link rel="icon" href="/i.png"><a href="/y">x</a>`;
    expect(extractIconHrefs(html, BASE)).toEqual(["https://blog.example.com/i.png"]);
  });

  it("rel 大小写与单词顺序不敏感（ICON SHORTCUT）", () => {
    expect(extractIconHrefs(`<LINK REL="ICON SHORTCUT" HREF="/i.ico">`, BASE)).toEqual([
      "https://blog.example.com/i.ico",
    ]);
  });

  it("支持单引号与无引号属性写法", () => {
    const html = `<link rel=icon href='/a.png'><link rel='icon' href=/b.png>`;
    expect(extractIconHrefs(html, BASE)).toEqual([
      "https://blog.example.com/a.png",
      "https://blog.example.com/b.png",
    ]);
  });

  it("相对路径以 base 补全，协议相对地址沿用当前协议", () => {
    const html = `<link rel="icon" href="icon.png"><link rel="icon" href="//cdn.example.com/i.png">`;
    expect(extractIconHrefs(html, BASE)).toEqual([
      "https://blog.example.com/icon.png",
      "https://cdn.example.com/i.png",
    ]);
  });

  it("相对路径按 base 的目录层级补全", () => {
    expect(extractIconHrefs(`<link rel="icon" href="i.png">`, "https://a.com/sub/page")).toEqual([
      "https://a.com/sub/i.png",
    ]);
  });

  it("跳过 data: 等不可探测协议，并对重复地址去重", () => {
    const html = `<link rel="icon" href="data:image/png;base64,AAA"><link rel="icon" href="/i.png"><link rel="shortcut icon" href="/i.png">`;
    expect(extractIconHrefs(html, BASE)).toEqual(["https://blog.example.com/i.png"]);
  });

  it("没有图标声明时返回空数组", () => {
    expect(extractIconHrefs(`<head><title>x</title></head>`, BASE)).toEqual([]);
  });
});
