/**
 * 壁纸缓存的分池标签、预算组与来源（前后端共用，纯函数模块）。
 *
 * 为什么单独成一个文件：标签 → 「预算组 / 来源」的映射，既要被服务端用于额度统计
 * （lib/wallpaperCache.ts），也要被后台界面用于分类展示（MediaPanel、图片选择器）。
 * 服务端那份引了 node:fs，客户端组件不能直接引用，故把纯映射与分组逻辑抽到这里。
 *
 * 注意：本模块不得引入 node: 内置模块。
 *
 * 两个维度各自回答一个问题：
 * - **预算组**（budget）谁在用 —— 电脑 / 手机 / 必应共享，决定各占多少额度
 * - **来源**（source）图从哪来 —— 风景 / 动漫 / 必应，决定题材
 *
 * 之所以预算组不按设备简单切分：风景端的手机默认值仍是横图源（上游没有竖版风景），
 * 若与动漫端共用一个池，手机选「动漫」时仍可能抽到那张横图。因此分池必须同时带
 * 「源 + 设备」两个维度；而与设备无关的源（必应每日壁纸）用 `shared`，手机与电脑共用一池。
 */

import type { WallpaperDevice } from "./external-api";

/** 分池标签：与设备无关的源用 shared；风景 / 动漫按「源 + 设备」分池 */
export type WallpaperCacheTag = "shared" | `landscape:${WallpaperDevice}` | `anime:${WallpaperDevice}`;

/**
 * 缓存预算组：上限既不看分池总数、也不看全局总数，而是按「谁在用」分组。
 *
 * - `pc`     电脑：风景:pc + 动漫:pc
 * - `mobile` 手机：风景:mobile + 动漫:mobile
 * - `shared` 必应这类与设备无关的源（含升级前没有标签的历史条目）
 *
 * 这样「手机别占电脑的额度」才成立：手机池攒满了也不会挤掉电脑的图。
 */
export type WallpaperCacheBudget = "pc" | "mobile" | "shared";

/** 预算组的中文名（后台展示用） */
export const CACHE_BUDGET_LABELS: Record<WallpaperCacheBudget, string> = {
  pc: "电脑",
  mobile: "手机",
  shared: "必应共享",
};

/** 后台展示用的预算组顺序 */
export const CACHE_BUDGETS: WallpaperCacheBudget[] = ["pc", "mobile", "shared"];

/** 图片来源 */
export type WallpaperCacheSource = "landscape" | "anime" | "shared" | "untagged";

/** 来源的中文名（后台展示用） */
export const CACHE_SOURCE_LABELS: Record<WallpaperCacheSource, string> = {
  landscape: "风景",
  anime: "动漫",
  shared: "必应",
  untagged: "未分组",
};

/** 后台展示用的来源顺序（两级分组的第二级） */
export const CACHE_SOURCES: WallpaperCacheSource[] = ["landscape", "anime", "shared", "untagged"];

/**
 * 分池标签 → 预算组。
 * 升级前的历史条目没有标签，只有 `shared` 允许复用它们，因此一律计入 `shared`。
 */
export function cacheBudgetFor(tag: WallpaperCacheTag | null | undefined): WallpaperCacheBudget {
  if (tag === "landscape:pc" || tag === "anime:pc") return "pc";
  if (tag === "landscape:mobile" || tag === "anime:mobile") return "mobile";
  return "shared";
}

/**
 * 分池标签 → 来源。
 * 无标签（历史条目）与非法标签都归入 `untagged`，展示成「未分组」而不是硬塞进某个源 ——
 * 这些图到底是什么题材已无从判断，标成「风景」会误导。
 */
export function cacheSourceFor(tag: WallpaperCacheTag | null | undefined): WallpaperCacheSource {
  if (tag === "landscape:pc" || tag === "landscape:mobile") return "landscape";
  if (tag === "anime:pc" || tag === "anime:mobile") return "anime";
  if (tag === "shared") return "shared";
  return "untagged";
}

/**
 * 标签的可读文案，形如「风景 · 电脑」「必应」「未分组」。
 * 用于缓存卡片角标：原始标签（anime:pc）对使用者没有意义。
 */
export function cacheTagLabel(tag: WallpaperCacheTag | null | undefined): string {
  const source = cacheSourceFor(tag);
  if (source === "untagged") return CACHE_SOURCE_LABELS.untagged;
  if (source === "shared") return CACHE_SOURCE_LABELS.shared;
  return `${CACHE_SOURCE_LABELS[source]} · ${CACHE_BUDGET_LABELS[cacheBudgetFor(tag)]}`;
}

/** 两级分组里的一组（同一预算组、同一来源） */
export interface WallpaperCacheSourceGroup<T> {
  source: WallpaperCacheSource;
  label: string;
  items: T[];
}

/** 两级分组里的一个预算组，内含按来源切分的子组 */
export interface WallpaperCacheBudgetGroup<T> {
  budget: WallpaperCacheBudget;
  label: string;
  /** 该预算组下的总张数（各来源子组之和） */
  count: number;
  sources: WallpaperCacheSourceGroup<T>[];
}

/**
 * 把缓存条目切成「预算组 → 来源」两级。
 *
 * 顺序固定为 CACHE_BUDGETS / CACHE_SOURCES 的声明顺序（而非按数量排序）：
 * 组的位置在张数变化时不跳动，使用者才能凭位置记住「手机那组在哪」。
 * 空组被剔除，避免渲染出一堆「0 张」的空标题。
 */
export function groupCachedWallpapers<T extends { tag: WallpaperCacheTag | null }>(
  items: T[]
): WallpaperCacheBudgetGroup<T>[] {
  return CACHE_BUDGETS.map((budget) => {
    const sources = CACHE_SOURCES.map((source) => ({
      source,
      label: CACHE_SOURCE_LABELS[source],
      items: items.filter(
        (item) => cacheBudgetFor(item.tag) === budget && cacheSourceFor(item.tag) === source
      ),
    })).filter((group) => group.items.length > 0);
    return {
      budget,
      label: CACHE_BUDGET_LABELS[budget],
      count: sources.reduce((sum, group) => sum + group.items.length, 0),
      sources,
    };
  }).filter((group) => group.count > 0);
}