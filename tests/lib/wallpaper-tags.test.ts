import { describe, it, expect } from "vitest";
import {
  cacheBudgetFor,
  cacheSourceFor,
  cacheTagLabel,
  groupCachedWallpapers,
  CACHE_BUDGETS,
  CACHE_SOURCES,
  type WallpaperCacheTag,
} from "@/lib/wallpaperTags";

/**
 * 壁纸缓存的「预算组 → 来源」两级归类。
 *
 * 这份逻辑被 MediaPanel（媒体库面板）与 MediaImagePicker（图片选择器）共用，
 * 一旦映射写反，会出现「同一张图在两个界面里被分到不同组」这种最难排查的不一致，
 * 因此把映射与分组顺序都单独锁住。
 */

describe("cacheBudgetFor（标签 → 预算组）", () => {
  it("风景 / 动漫按设备归入电脑或手机", () => {
    expect(cacheBudgetFor("landscape:pc")).toBe("pc");
    expect(cacheBudgetFor("anime:pc")).toBe("pc");
    expect(cacheBudgetFor("landscape:mobile")).toBe("mobile");
    expect(cacheBudgetFor("anime:mobile")).toBe("mobile");
  });

  it("与设备无关的源（必应）与无标签的历史条目都归入共享组", () => {
    expect(cacheBudgetFor("shared")).toBe("shared");
    expect(cacheBudgetFor(null)).toBe("shared");
    expect(cacheBudgetFor(undefined)).toBe("shared");
  });
});

describe("cacheSourceFor（标签 → 来源）", () => {
  it("风景 / 动漫跨设备同源", () => {
    expect(cacheSourceFor("landscape:pc")).toBe("landscape");
    expect(cacheSourceFor("landscape:mobile")).toBe("landscape");
    expect(cacheSourceFor("anime:pc")).toBe("anime");
    expect(cacheSourceFor("anime:mobile")).toBe("anime");
  });

  it("无标签的历史条目标为「未分组」，不硬塞进某个题材", () => {
    expect(cacheSourceFor("shared")).toBe("shared");
    expect(cacheSourceFor(null)).toBe("untagged");
  });
});

describe("cacheTagLabel（卡片角标文案）", () => {
  it("原始标签对使用者无意义，转成「来源 · 设备」", () => {
    expect(cacheTagLabel("anime:pc")).toBe("动漫 · 电脑");
    expect(cacheTagLabel("landscape:mobile")).toBe("风景 · 手机");
  });

  it("必应不带设备维度，未分组直接展示「未分组」", () => {
    expect(cacheTagLabel("shared")).toBe("必应");
    expect(cacheTagLabel(null)).toBe("未分组");
  });
});

describe("groupCachedWallpapers（两级分组）", () => {
  it("先按预算组分段，段内再按来源细分", () => {
    const groups = groupCachedWallpapers([
      { tag: "anime:pc" as WallpaperCacheTag, id: "a" },
      { tag: "landscape:pc" as WallpaperCacheTag, id: "b" },
      { tag: "anime:mobile" as WallpaperCacheTag, id: "c" },
      { tag: "shared" as WallpaperCacheTag, id: "d" },
    ]);

    expect(groups.map((g) => g.budget)).toEqual(["pc", "mobile", "shared"]);
    expect(groups.map((g) => g.label)).toEqual(["电脑", "手机", "必应共享"]);
    expect(groups.map((g) => g.count)).toEqual([2, 1, 1]);
    // 电脑组内两个来源，顺序固定为风景在前、动漫在后
    expect(groups[0].sources.map((s) => s.source)).toEqual(["landscape", "anime"]);
    expect(groups[0].sources.map((s) => s.items.length)).toEqual([1, 1]);
  });

  it("顺序固定不随张数变化（组的位置稳定，使用者才能凭位置记忆）", () => {
    const few = groupCachedWallpapers([{ tag: "anime:pc" as WallpaperCacheTag, id: "a" }]);
    const many = groupCachedWallpapers([
      { tag: "anime:pc" as WallpaperCacheTag, id: "a" },
      { tag: "anime:pc" as WallpaperCacheTag, id: "b" },
      { tag: "anime:pc" as WallpaperCacheTag, id: "c" },
    ]);
    expect(few.map((g) => g.budget)).toEqual(many.map((g) => g.budget));
    expect(few.map((g) => g.label)).toEqual(many.map((g) => g.label));
  });

  it("空组被剔除：不渲染一堆「0 张」的空标题", () => {
    const groups = groupCachedWallpapers([{ tag: "shared" as WallpaperCacheTag, id: "a" }]);
    expect(groups.map((g) => g.budget)).toEqual(["shared"]);
    expect(groups[0].sources.map((s) => s.source)).toEqual(["shared"]);
  });

  it("无标签的历史条目落进「必应共享 → 未分组」", () => {
    const groups = groupCachedWallpapers([{ tag: null, id: "a" }]);
    expect(groups).toHaveLength(1);
    expect(groups[0].budget).toBe("shared");
    expect(groups[0].sources[0].source).toBe("untagged");
    expect(groups[0].sources[0].label).toBe("未分组");
  });

  it("空列表返回空数组", () => {
    expect(groupCachedWallpapers([])).toEqual([]);
  });

  it("声明顺序常量覆盖全部预算组与来源", () => {
    expect(CACHE_BUDGETS).toEqual(["pc", "mobile", "shared"]);
    expect(CACHE_SOURCES).toEqual(["landscape", "anime", "shared", "untagged"]);
  });
});