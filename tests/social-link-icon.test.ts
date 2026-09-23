import { describe, expect, it } from "vitest";
import { socialLinkSchema } from "@/lib/validation";
import { isInlineSvgValue } from "@/lib/iconValue";

// 一段阿里 iconfont 风格的内联 SVG（带固定 200x200 与 class）
const INLINE_ICON_SVG = `<svg t="1789304190843" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="6975" width="200" height="200"><path d="M1 2" fill="#000000" p-id="6976"></path></svg>`;

const base = { name: "示例", url: "https://example.com", tip: "去看看", sort: 0 };
const passes = (icon: string) =>
  expect(socialLinkSchema.safeParse({ ...base, icon }).success).toBe(true);
const rejects = (icon: string) =>
  expect(socialLinkSchema.safeParse({ ...base, icon }).success).toBe(false);

describe("socialLinkSchema 图标来源校验", () => {
  it("纯图标名 / lucide 前缀仍通过", () => {
    passes("icon-github");
    passes("github");
    passes("lucide:book-open");
    passes("Blog"); // @vicons/fa 预设名
  });

  it("Iconify prefix:name 通过", () => {
    passes("fa:github");
    passes("mdi:home");
    passes("tabler:brand-github");
  });

  it("内联 SVG 代码通过（长度上限放宽）", () => {
    passes(INLINE_ICON_SVG);
  });

  it("图片外链 / 本地图片路径 / 随机图通过", () => {
    passes("https://x.com/a.png");
    passes("/images/icon/github.png");
    passes("/api/uploads/file/abc.webp");
    passes("/assets/logo.svg"); // 任意站点内相对路径
    passes("random:city");
  });

  it("夹带 script 的 SVG 被拒绝", () => {
    rejects("<svg viewBox=\"0 0 24 24\"><script>alert(1)</script></svg>");
  });

  it("空图标（必填）被拒绝", () => {
    rejects("");
  });

  it("非法迷你值被拒绝", () => {
    rejects("not a valid !! icon");
  });
});

describe("isInlineSvgValue 与 renderInlineSvg 联动", () => {
  it("识别用户粘贴的 iconfont svg 为内联 SVG", () => {
    expect(isInlineSvgValue(INLINE_ICON_SVG)).toBe(true);
  });
});