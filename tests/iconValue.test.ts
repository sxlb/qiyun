import { describe, expect, it } from "vitest";
import {
  isInlineSvgValue,
  isIconifyValue,
  isLocalImagePath,
  renderInlineSvg,
  resolveIconImageSrc,
} from "@/lib/iconValue";
import { resolveFaPresetLucideName, FA_PRESET_NAMES } from "@/lib/iconValue";

describe("isInlineSvgValue（内联 SVG 代码判定）", () => {
  it("识别以 <svg 开头的完整粘贴片段", () => {
    expect(
      isInlineSvgValue(
        '<svg t="1789304190843" viewBox="0 0 1024 1024" width="200" height="200"><path d="M1 2"/></svg>'
      )
    ).toBe(true);
  });

  it("带前导空白的 <svg 也能识别", () => {
    expect(isInlineSvgValue('  <svg viewBox="0 0 24 24"></svg>')).toBe(true);
  });

  it("纯图标名 / 空值不是内联 SVG", () => {
    expect(isInlineSvgValue("icon-github")).toBe(false);
    expect(isInlineSvgValue("")).toBe(false);
    expect(isInlineSvgValue(null as unknown as string)).toBe(false);
  });

  it("夹带 <script 的内容视为不安全，拒绝", () => {
    expect(
      isInlineSvgValue('<svg viewBox="0 0 24 24"><script>alert(1)</script></svg>')
    ).toBe(false);
  });
});

describe("isIconifyValue（Iconify prefix:name 判定）", () => {
  it("识别常见 Iconify 格式", () => {
    expect(isIconifyValue("fa:github")).toBe(true);
    expect(isIconifyValue("mdi:home")).toBe(true);
    expect(isIconifyValue("tabler:brand-github")).toBe(true);
    expect(isIconifyValue("simple-icons:bilibili")).toBe(true);
  });

  it("图片外链 / 内联 SVG / 空值不是 Iconify", () => {
    expect(isIconifyValue("https://x.com/a.png")).toBe(false);
    expect(isIconifyValue("<svg viewBox></svg>")).toBe(false);
    expect(isIconifyValue("")).toBe(false);
    expect(isIconifyValue(null as unknown as string)).toBe(false);
  });

  it("http:开头不会被误判为 Iconify（x:y 形态的坑）", () => {
    expect(isIconifyValue("http://x.com/a")).toBe(false);
  });

  it("保留前缀 lucide: / random: / mailto: 不会被误判为 Iconify", () => {
    expect(isIconifyValue("lucide:github")).toBe(false);
    expect(isIconifyValue("random:city")).toBe(false);
    expect(isIconifyValue("mailto:a@b.com")).toBe(false);
  });
});

describe("renderInlineSvg（内联 SVG 规范化）", () => {
  const sample = '<svg t="abc" class="icon" viewBox="0 0 1024 1024" width="200" height="200"><path d="M1 2"/></svg>';

  it("把 width/height 统一为目标尺寸（贴的阿里 iconfont 常带 200x200）", () => {
    const out = renderInlineSvg(sample, 32);
    expect(out).toContain('width="32"');
    expect(out).toContain('height="32"');
    expect(out).not.toContain('width="200"');
  });

  it("保留 viewBox 与内部 path", () => {
    const out = renderInlineSvg(sample, 32);
    expect(out).toContain('viewBox="0 0 1024 1024"');
    expect(out).toContain('<path d="M1 2"/>');
  });

  it("移除事件属性与外部链接，防止注入", () => {
    const evil =
      '<svg onload="alert(1)" viewBox="0 0 24 24"><path d="M1"/></svg>';
    const out = renderInlineSvg(evil, 24);
    expect(out).not.toContain("onload");
  });

  it("移除 href / src，防止外链注入", () => {
    const evil = '<svg viewBox="0 0 24 24"><use href="https://evil.com/x.svg"/></svg>';
    const out = renderInlineSvg(evil, 24);
    expect(out).not.toContain("evil.com");
  });
});

describe("isLocalImagePath（本地图片路径判定）", () => {
  it("识别站点内相对路径（含无扩展名的路径）", () => {
    expect(isLocalImagePath("/images/icon/github.png")).toBe(true);
    expect(isLocalImagePath("/api/uploads/file/abc.webp")).toBe(true);
    expect(isLocalImagePath("/assets/logo")).toBe(true);
  });

  it("协议相对地址 //host 与外链不算本地路径", () => {
    expect(isLocalImagePath("//cdn.example.com/a.png")).toBe(false);
    expect(isLocalImagePath("https://x.com/a.png")).toBe(false);
    expect(isLocalImagePath("github")).toBe(false);
  });
});

describe("resolveIconImageSrc（图片型值解析）", () => {
  it("识别 http(s) 外链与本地图片路径", () => {
    expect(resolveIconImageSrc("https://x.com/a.png", 32)).toBe("https://x.com/a.png");
    expect(resolveIconImageSrc("/images/icon/github.png", 32)).toBe("/images/icon/github.png");
    expect(resolveIconImageSrc("/api/uploads/123abc.webp", 32)).toBe("/api/uploads/123abc.webp");
  });

  it("random: 关键词生成随机图直链", () => {
    expect(resolveIconImageSrc("random:city", 32)).toContain("loremflickr.com/32/32/city");
  });

  it("内联 SVG / Iconify / 纯图标名 → 返回 null 走图标渲染分支", () => {
    expect(resolveIconImageSrc('<svg viewBox="0 0 24 24"></svg>', 32)).toBeNull();
    expect(resolveIconImageSrc("fa:github", 32)).toBeNull();
    expect(resolveIconImageSrc("icon-github", 32)).toBeNull();
    expect(resolveIconImageSrc("", 32)).toBeNull();
  });

  it("协议相对地址不当作图片（避免 // 被当成外链）", () => {
    expect(resolveIconImageSrc("//cdn.example.com/a.png", 32)).toBeNull();
  });
});

describe("@vicons/fa 预设名映射（iconPreset）", () => {
  it("历史数据里的 PascalCase 预设名可映射到 lucide 图标名", () => {
    expect(resolveFaPresetLucideName("Blog")).toBe("newspaper");
    expect(resolveFaPresetLucideName("CompactDisc")).toBe("disc");
    expect(resolveFaPresetLucideName("LaptopCode")).toBe("code");
  });

  it("小写普通图标名不会被误判为预设名", () => {
    expect(resolveFaPresetLucideName("blog")).toBeNull();
    expect(resolveFaPresetLucideName("cloud")).toBeNull();
    expect(resolveFaPresetLucideName("")).toBeNull();
    expect(resolveFaPresetLucideName(null)).toBeNull();
  });

  it("预设名清单与 home 项目 WebIcon.vue 的 PRESET_MAP 保持一致", () => {
    expect(FA_PRESET_NAMES.sort()).toEqual(
      ["Blog", "Cloud", "CompactDisc", "Compass", "Book", "Fire", "LaptopCode"].sort()
    );
  });
});
