import { describe, it, expect } from "vitest";
import {
  RANDOM_PREFIX,
  LEGACY_RANDOM_PREFIX,
  isRandomImageValue,
  extractRandomKeyword,
  getRandomImageUrl,
  resolveIconImageSrc,
} from "@/lib/iconValue";

describe("lib/iconValue（图标/封面值解析）", () => {
  it("识别随机图前缀（新 random: 与旧 unsplash: 均兼容）", () => {
    expect(isRandomImageValue(`${RANDOM_PREFIX}nature`)).toBe(true);
    expect(isRandomImageValue(`${LEGACY_RANDOM_PREFIX}nature`)).toBe(true);
    expect(isRandomImageValue("lucide:github")).toBe(false);
    expect(isRandomImageValue("https://example.com/a.png")).toBe(false);
    expect(isRandomImageValue("")).toBe(false);
  });

  it("提取随机图关键词", () => {
    expect(extractRandomKeyword("random:nature")).toBe("nature");
    expect(extractRandomKeyword("unsplash:city sky")).toBe("city sky");
    expect(extractRandomKeyword("lucide:github")).toBe("");
  });

  it("生成随机图直链：loremflickr（source.unsplash.com 已停服），空关键词兜底 random", () => {
    expect(getRandomImageUrl("nature", 60)).toBe("https://loremflickr.com/60/60/nature");
    expect(getRandomImageUrl("city sky", 120, 80)).toBe("https://loremflickr.com/120/80/city%20sky");
    expect(getRandomImageUrl("   ", 32)).toBe("https://loremflickr.com/32/32/random");
    // 不应再产出已停服的 unsplash 源
    expect(getRandomImageUrl("nature", 60)).not.toContain("source.unsplash.com");
  });

  it("resolveIconImageSrc：随机图/外链/媒体库路径返回图片地址，图标名返回 null", () => {
    expect(resolveIconImageSrc("random:nature", 60)).toBe("https://loremflickr.com/60/60/nature");
    expect(resolveIconImageSrc("unsplash:nature", 60)).toBe("https://loremflickr.com/60/60/nature");
    expect(resolveIconImageSrc("https://example.com/a.png", 60)).toBe("https://example.com/a.png");
    expect(resolveIconImageSrc("/api/uploads/a.png", 60)).toBe("/api/uploads/a.png");
    expect(resolveIconImageSrc("lucide:github", 60)).toBeNull();
    expect(resolveIconImageSrc("icon-github", 60)).toBeNull();
    expect(resolveIconImageSrc("", 60)).toBeNull();
  });
});
