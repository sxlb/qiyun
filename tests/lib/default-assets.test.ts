import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  DEFAULT_WALLPAPERS,
  DEFAULT_LANDSCAPE_WALLPAPERS,
  DEFAULT_ANIME_WALLPAPERS,
  DEFAULT_AVATAR,
  pickRandomDefaultWallpaper,
  avatarOrDefault,
} from "@/lib/default-assets";

describe("内置默认媒体资源（随项目打包的壁纸与头像）", () => {
  it("壁纸清单为站点内路径，且风景 / 动漫两个池子不重叠且构成全集", () => {
    expect(DEFAULT_WALLPAPERS.length).toBeGreaterThan(0);
    for (const p of DEFAULT_WALLPAPERS) {
      expect(p).toMatch(/^\/images\/wallpaper\/\d{2}\.webp$/);
    }
    // 两个池子不能有交集：否则「选动漫却给风景」的判定会失真
    for (const p of DEFAULT_LANDSCAPE_WALLPAPERS) {
      expect(DEFAULT_ANIME_WALLPAPERS).not.toContain(p);
    }
    expect(DEFAULT_WALLPAPERS).toHaveLength(
      DEFAULT_LANDSCAPE_WALLPAPERS.length + DEFAULT_ANIME_WALLPAPERS.length
    );
  });

  it("清单里的文件确实存在于 public/ 下（防止代码引用了没提交的图）", () => {
    for (const asset of [...DEFAULT_WALLPAPERS, DEFAULT_AVATAR]) {
      const file = path.join(process.cwd(), "public", asset.replace(/^\//, ""));
      expect(existsSync(file), `${asset} 不存在`).toBe(true);
    }
  });

  it("按 coverType 取同类兜底图（风景与动漫不串门）", () => {
    for (let i = 0; i < 80; i += 1) {
      expect(DEFAULT_LANDSCAPE_WALLPAPERS).toContain(pickRandomDefaultWallpaper("landscape"));
      expect(DEFAULT_ANIME_WALLPAPERS).toContain(pickRandomDefaultWallpaper("anime"));
    }
  });

  it("未指定或其它 coverType 时从全部里取", () => {
    for (let i = 0; i < 80; i += 1) {
      expect(DEFAULT_WALLPAPERS).toContain(pickRandomDefaultWallpaper());
      expect(DEFAULT_WALLPAPERS).toContain(pickRandomDefaultWallpaper("bing"));
      expect(DEFAULT_WALLPAPERS).toContain(pickRandomDefaultWallpaper("custom"));
    }
  });

  it("头像兜底：空值一律回落到内置默认头像", () => {
    expect(avatarOrDefault("")).toBe(DEFAULT_AVATAR);
    expect(avatarOrDefault("   ")).toBe(DEFAULT_AVATAR);
    expect(avatarOrDefault(null)).toBe(DEFAULT_AVATAR);
    expect(avatarOrDefault(undefined)).toBe(DEFAULT_AVATAR);
    // 已配置的头像原样返回，不被兜底覆盖
    expect(avatarOrDefault("https://example.com/a.png")).toBe("https://example.com/a.png");
  });
});
