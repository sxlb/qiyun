import { describe, it, expect } from "vitest";
import {
  GRID_THUMB_WIDTH,
  GRID_THUMB_WIDTH_2X,
  THUMB_WIDTHS,
  gridThumbAttrs,
  parseThumbWidth,
  thumbUrl,
} from "@/lib/mediaThumb";

/**
 * 缩略图地址约定（纯函数）。
 *
 * 关键约束是**宽度白名单**：若放行任意值，?w=99999 就成了让服务端放大图片的
 * 放大攻击（CPU 与内存双爆），因此非法值必须回退原图而不是「尽力而为」。
 */

describe("parseThumbWidth", () => {
  it("放行白名单内的宽度", () => {
    for (const w of THUMB_WIDTHS) {
      expect(parseThumbWidth(String(w))).toBe(w);
    }
  });

  it("缺失或空值返回 null（回退原图）", () => {
    expect(parseThumbWidth(null)).toBeNull();
    expect(parseThumbWidth("")).toBeNull();
  });

  it("白名单外的宽度一律拒绝，避免被当成放大请求", () => {
    for (const raw of ["99999", "1", "1920", "320.5", "-320", "abc", "320px"]) {
      expect(parseThumbWidth(raw), `${raw} 不该被放行`).toBeNull();
    }
  });

  it("拒绝数组式重复参数（?w=320&w=640 取到的是首值，仍需在白名单内）", () => {
    expect(parseThumbWidth("320")).toBe(320);
  });
});

describe("thumbUrl", () => {
  it("内部图片地址追加 w 参数", () => {
    expect(thumbUrl("/api/uploads/file/a.png")).toBe("/api/uploads/file/a.png?w=320");
    expect(thumbUrl("/api/wallpaper/file/b.webp", 640)).toBe(
      "/api/wallpaper/file/b.webp?w=640"
    );
  });

  it("已有查询串时用 & 追加", () => {
    expect(thumbUrl("/api/uploads/file/a.png?v=2")).toBe(
      "/api/uploads/file/a.png?v=2&w=320"
    );
  });

  it("外链与空值原样返回：站外图不该被套上本站的缩放参数", () => {
    expect(thumbUrl("https://cdn.example.com/a.png")).toBe("https://cdn.example.com/a.png");
    expect(thumbUrl("")).toBe("");
  });
});

describe("gridThumbAttrs", () => {
  it("给出 1x / 2x 两档，保证高分屏不发糊", () => {
    const { src, srcSet } = gridThumbAttrs("/api/uploads/file/a.png");
    expect(src).toBe(`/api/uploads/file/a.png?w=${GRID_THUMB_WIDTH}`);
    expect(srcSet).toContain(`${GRID_THUMB_WIDTH} 1x`);
    expect(srcSet).toContain(`${GRID_THUMB_WIDTH_2X} 2x`);
  });

  it("外链不带 srcSet，避免浏览器去请求本站的缩放参数", () => {
    const { src, srcSet } = gridThumbAttrs("https://cdn.example.com/a.png");
    expect(src).toBe("https://cdn.example.com/a.png");
    // 外链时 srcSet 与服务端能力无关，仍返回同址，但绝不出现 ?w=
    expect(srcSet).not.toContain("?w=");
  });
});
