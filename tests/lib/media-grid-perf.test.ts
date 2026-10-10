import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { serveFile } from "@/lib/file-serving";

/**
 * 后台图片网格的「加载不卡顿」契约。
 *
 * 背景：媒体库一页 24 张、壁纸缓存最多 300 张，后台一律原图直出（不做缩略图）。
 * 两个成因会让「图片还没加载完，页面先卡住」：
 * 1. 浏览器侧：所有卡片同时参与布局绘制 → 一次性解码上百张大图，主线程被解码占满；
 * 2. 服务端侧：每张图都 new Uint8Array(buffer) 复制整份文件 → Node 单线程上堆积
 *    内存拷贝，把同时发出的分页 / 列表请求一起拖慢。
 * 因此这里锁住四条：视口外卡片跳过渲染、图片异步解码且让路给接口请求、
 * 服务端零拷贝、以及这些属性真的被组件绑上（CSS 契约不绑就是空文）。
 */

const ROOT = new URL("../../", import.meta.url);
const css = readFileSync(new URL("app/globals.css", ROOT), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  ""
);
const panel = readFileSync(new URL("components/admin/MediaPanel.tsx", ROOT), "utf8");
const picker = readFileSync(new URL("components/admin/MediaImagePicker.tsx", ROOT), "utf8");
const serving = readFileSync(new URL("lib/file-serving.ts", ROOT), "utf8");

/** 取某个选择器的声明块 */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`未在 globals.css 中找到 ${selector} 规则`);
  return match[1];
}

describe("服务端取图：零拷贝", () => {
  it("已有字节视图时直接复用，不做整份复制", () => {
    // 关键是「先判断、再按需转换」：无条件 new Uint8Array(buffer) 会把整份文件复制一遍
    expect(serving).toMatch(
      /instanceof Uint8Array\s*\?\s*file\.buffer\s*:\s*new Uint8Array\(file\.buffer\)/
    );
  });

  it("复用的同时字节内容保持一致", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0x01]);
    const res = serveFile({ buffer: bytes, contentType: "image/jpeg" });
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it("普通数组入参（测试路径）仍能正常出图", () => {
    const res = serveFile({ buffer: [1, 2, 3], contentType: "image/png" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    // 图片文件名唯一，可长期缓存：缺少该头会让每次进后台都重新回源
    expect(res.headers.get("Cache-Control")).toContain("immutable");
  });

  it("文件不存在时返回 404，而不是空图", () => {
    expect(serveFile(null).status).toBe(404);
  });
});

describe("视口外卡片跳过渲染与解码", () => {
  it(".media-grid-cell 使用 content-visibility: auto 且带占位尺寸", () => {
    const body = ruleBody(".media-grid-cell");
    expect(body).toMatch(/content-visibility:\s*auto/);
    // 不给 contain-intrinsic-size 会让滚动条在滚动时反复跳动
    expect(body).toMatch(/contain-intrinsic-size:\s*auto\s+\d/);
  });

  it("两个图片网格（媒体库面板 / 图片选择器）都挂上了该类", () => {
    expect(panel).toContain("media-grid-cell");
    expect(picker).toContain("media-grid-cell");
  });

  it("弹层格子用更小的占位高度，避免滚动条先长后短地跳", () => {
    const compact = ruleBody(".media-grid-cell--compact");
    const h = Number(compact.match(/contain-intrinsic-size:\s*auto\s+(\d+)px/)?.[1]);
    const panelH = Number(
      ruleBody(".media-grid-cell").match(/contain-intrinsic-size:\s*auto\s+(\d+)px/)?.[1]
    );
    expect(h).toBeGreaterThan(0);
    expect(h, "弹层格子只有图、没有文件名与按钮，应明显矮于面板卡片").toBeLessThan(panelH);
    // 组件侧必须真的用上这个类，否则 CSS 契约只是空文
    expect(picker).toContain("media-grid-cell--compact");
  });
});

describe("图片加载不抢占接口请求", () => {
  it("网格缩略图一律 decoding=async + fetchPriority=low", () => {
    for (const [name, source] of [
      ["MediaPanel", panel],
      ["MediaImagePicker", picker],
    ] as const) {
      const imgs = source.match(/<img[\s\S]*?\/>/g) ?? [];
      // 只校验网格缩略图（带 aspect-square 的那些），预览大图不强制 fetchPriority
      const thumbs = imgs.filter((tag) => tag.includes("aspect-square"));
      expect(thumbs.length, `${name} 未找到网格缩略图`).toBeGreaterThan(0);
      for (const tag of thumbs) {
        expect(tag, `${name} 的缩略图缺少 decoding=async`).toContain('decoding="async"');
        expect(tag, `${name} 的缩略图缺少 fetchPriority=low`).toContain('fetchPriority="low"');
        expect(tag, `${name} 的缩略图缺少懒加载`).toContain('loading="lazy"');
      }
    }
  });

  it("网格一律走缩略图地址，不再原图直出", () => {
    for (const [name, source] of [
      ["MediaPanel", panel],
      ["MediaImagePicker", picker],
    ] as const) {
      const thumbs = (source.match(/<img[\s\S]*?\/>/g) ?? []).filter((tag) =>
        tag.includes("aspect-square")
      );
      for (const tag of thumbs) {
        // 原图直出是卡顿根因：网格必须通过 gridThumbAttrs 拿到 ?w=320/640
        expect(tag, `${name} 的缩略图未走 gridThumbAttrs`).toContain("gridThumbAttrs(");
        expect(tag, `${name} 的缩略图仍直接绑定原图 src`).not.toMatch(/\ssrc=\{item\.url\}/);
      }
    }
  });

  it("预览大图仍用原图（缩放会糊，且预览就是要看细节）", () => {
    // 预览弹层是单张，不存在批量解码问题，必须给原图
    expect(panel).toMatch(/src=\{previewUrl\}/);
  });
});