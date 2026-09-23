"use client";

/**
 * FontAwesome 图标选择器（后台用）
 * - 图标清单来自 /api/icons-fa（服务端代理 Iconify /collection API，内存缓存 1 小时）
 * - 图标图形按页批量拉取：一次请求取回整页 SVG body（Iconify JSON API），避免逐图 80 次请求
 * - 支持分类筛选 + 名称搜索 + 分页；点击即选中
 * - 选中值格式： "fa6-solid:图标名" | "fa6-brands:图标名"
 */

import { useState, useMemo, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Loader2 } from "lucide-react";

/* ==================== 类型定义 ==================== */

export interface FaIconOption {
  name: string;
  category?: string;
  prefix: "fa6-solid" | "fa6-brands";
}

export interface FaIconPickerProps {
  value: string;
  onChange: (value: string) => void;
}

/** 单个图标的 SVG 图形数据（body 已含 fill="currentColor"） */
interface FaSvgBody {
  body: string;
  width: number;
  height: number;
}

/* ==================== 常量 ==================== */

const SEARCH_DEBOUNCE_MS = 200;
const ITEMS_PER_PAGE = 80;
/** 单次批量请求的图标个数（控制 URL 长度） */
const CHUNK_SIZE = 48;
/** 网格内图标显示尺寸（px） */
const GRID_ICON_SIZE = 14;
/** 触发按钮预览图标尺寸（px） */
const PREVIEW_ICON_SIZE = 16;
const ICONIFY_API = "https://api.iconify.design";

/** 常用分类优先展示（排在搜索结果前面） */
const FA6_SOLID_CATEGORIES_ORDER = [
  "common",
  "people",
  "objects",
  "signs",
  "transportation",
  "weather",
  "files",
  "text-editor",
];

/** 选中值解析：fa6-solid:xxx / fa6-brands:xxx */
const FA_VALUE_RE = /^(fa6-(?:solid|brands)):(.+)$/;

/* ==================== 模块级缓存 ==================== */

/**
 * 图标 SVG 缓存（key = "prefix:name"）。
 * 值为 null 表示该图标不存在或加载失败，用于避免重复请求。
 */
const faBodyCache = new Map<string, FaSvgBody | null>();
/** 正在进行中的请求 key 集合（并发去重） */
const faInflight = new Set<string>();

/** 轻量清洗：Iconify 返回的 body 只应是 path/g 等图形元素，剔除脚本与内联事件做防御性处理 */
function sanitizeBody(body: string): string {
  return body
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

/**
 * 批量拉取图标 SVG body 并写入模块级缓存。
 * 按 prefix 分组、再按 CHUNK_SIZE 分片，每片一次请求；完成后回调 onUpdate 触发重渲染。
 */
async function loadBodies(icons: FaIconOption[], onUpdate: () => void): Promise<void> {
  const byPrefix = new Map<string, string[]>();

  for (const icon of icons) {
    const key = `${icon.prefix}:${icon.name}`;
    if (faBodyCache.has(key) || faInflight.has(key)) continue;
    faInflight.add(key);
    const list = byPrefix.get(icon.prefix) ?? [];
    list.push(icon.name);
    byPrefix.set(icon.prefix, list);
  }

  if (byPrefix.size === 0) return;

  const jobs: Promise<void>[] = [];

  for (const [prefix, names] of byPrefix) {
    for (let i = 0; i < names.length; i += CHUNK_SIZE) {
      const chunk = names.slice(i, i + CHUNK_SIZE);
      jobs.push(
        (async () => {
          try {
            const query = chunk.map((n) => encodeURIComponent(n)).join(",");
            const res = await fetch(`${ICONIFY_API}/${prefix}.json?icons=${query}`, {
              signal: AbortSignal.timeout(8000),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = (await res.json()) as {
              width?: number;
              height?: number;
              icons?: Record<string, { body: string; width?: number; height?: number }>;
            };
            const fallbackW = data.width ?? 512;
            const fallbackH = data.height ?? 512;
            for (const name of chunk) {
              const item = data.icons?.[name];
              faBodyCache.set(
                `${prefix}:${name}`,
                item
                  ? {
                      body: sanitizeBody(String(item.body ?? "")),
                      width: item.width ?? fallbackW,
                      height: item.height ?? fallbackH,
                    }
                  : null
              );
            }
          } catch (err) {
            console.error("[FaIconPicker] 批量加载图标失败:", prefix, err);
            // 失败也写入 null，避免反复重试同一批
            for (const name of chunk) faBodyCache.set(`${prefix}:${name}`, null);
          } finally {
            for (const name of chunk) faInflight.delete(`${prefix}:${name}`);
          }
        })()
      );
    }
  }

  await Promise.all(jobs);
  onUpdate();
}

/** 渲染一个已缓存的图标 SVG */
function FaIconSvg({ svg, size }: { svg: FaSvgBody; size: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${svg.width} ${svg.height}`}
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      style={{ display: "block", flexShrink: 0 }}
      dangerouslySetInnerHTML={{ __html: svg.body }}
    />
  );
}

/* ==================== 组件 ==================== */

export default function FaIconPicker({ value, onChange }: FaIconPickerProps) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [icons, setIcons] = useState<FaIconOption[]>([]);
  const [categories, setCategories] = useState<{ name: string; count: number }[]>([]);
  /** 仅用于在批量 SVG 到位后触发重渲染（缓存本身在模块级 Map 中） */
  const [bodyVersion, setBodyVersion] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fetchedRef = useRef(false);

  const bumpBodyVersion = () => setBodyVersion((v) => v + 1);

  // 挂载后拉取图标清单
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    let cancelled = false;
    setLoading(true);

    fetch("/api/icons-fa")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setIcons(data.icons || []);
        setCategories(data.categories || []);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        console.error("[FaIconPicker] 加载图标清单失败");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // 搜索防抖
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  // 点击面板外部收起
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // 搜索词 / 分类变化时回到第 1 页
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, categoryFilter]);

  // 过滤 + 排序
  const filteredIcons = useMemo(() => {
    let result = icons;

    if (categoryFilter !== "all") {
      result = result.filter((i) => i.category === categoryFilter);
    }
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      result = result.filter((i) => i.name.toLowerCase().includes(q));
    }

    // 常用分类优先，其次按名称字典序
    return [...result].sort((a, b) => {
      const pa = FA6_SOLID_CATEGORIES_ORDER.includes(a.category || "") ? 0 : 1;
      const pb = FA6_SOLID_CATEGORIES_ORDER.includes(b.category || "") ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return a.name.localeCompare(b.name);
    });
  }, [icons, debouncedSearch, categoryFilter]);

  // 分页
  const totalPages = Math.max(1, Math.ceil(filteredIcons.length / ITEMS_PER_PAGE));
  const pageStart = (page - 1) * ITEMS_PER_PAGE;
  const pageIcons = filteredIcons.slice(pageStart, pageStart + ITEMS_PER_PAGE);

  // 当前页图标集合的稳定 key：作为批量加载的依赖，避免数组引用变化导致重复请求
  const pageKey = pageIcons.map((i) => `${i.prefix}:${i.name}`).join(",");

  // 面板展开时批量加载当前页图标图形
  useEffect(() => {
    if (!open || !pageKey) return;
    let cancelled = false;
    void loadBodies(pageIcons, () => {
      if (!cancelled) bumpBodyVersion();
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pageKey]);

  // 选中值变化时确保其图形已缓存（供触发按钮预览）
  useEffect(() => {
    const m = FA_VALUE_RE.exec(value);
    if (!m) return;
    void loadBodies([{ prefix: m[1] as FaIconOption["prefix"], name: m[2] }], bumpBodyVersion);
  }, [value]);

  // 触发按钮上的选中项信息
  const selectedMatch = FA_VALUE_RE.exec(value);
  const selectedSvg = selectedMatch ? faBodyCache.get(`${selectedMatch[1]}:${selectedMatch[2]}`) : undefined;

  function selectIcon(icon: FaIconOption) {
    onChange(`${icon.prefix}:${icon.name}`);
    setOpen(false);
    setSearch("");
  }

  // 引用 bodyVersion：让「缓存写入」能驱动重渲染
  void bodyVersion;

  return (
    <div ref={containerRef} className="relative">
      {/* 触发按钮：已选中时展示图标 + 名称，未选中时展示可选数量 */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) setTimeout(() => inputRef.current?.focus(), 50);
        }}
        className="w-full justify-between gap-2 text-xs"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {selectedSvg && <FaIconSvg svg={selectedSvg} size={PREVIEW_ICON_SIZE} />}
          <span className="truncate">
            {selectedMatch
              ? selectedMatch[2]
              : loading
                ? "加载图标中..."
                : `${filteredIcons.length} 个图标可用`}
          </span>
        </span>
        <Search className="h-3.5 w-3.5 shrink-0 opacity-50" />
      </Button>

      {/* 下拉面板 */}
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-[420px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border bg-popover shadow-xl">
          {/* 搜索框 */}
          <div className="border-b p-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索图标名称（如 github、cart、bell）"
                spellCheck={false}
                className="h-8 pl-8 pr-2 text-xs"
              />
            </div>
          </div>

          {/* 分类筛选 */}
          {categories.length > 0 && (
            <div className="scrollbar-hide flex max-h-16 overflow-x-auto border-b px-2 py-1.5">
              <button
                type="button"
                onClick={() => setCategoryFilter("all")}
                className={`mr-1 shrink-0 rounded px-2 py-1 text-[11px] transition-colors ${
                  categoryFilter === "all"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent"
                }`}
              >
                全部 ({icons.length})
              </button>
              {categories.map((cat) => (
                <button
                  key={cat.name}
                  type="button"
                  onClick={() => setCategoryFilter(cat.name)}
                  className={`mr-1 shrink-0 rounded px-2 py-1 text-[11px] transition-colors ${
                    categoryFilter === cat.name
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {cat.name} ({cat.count})
                </button>
              ))}
            </div>
          )}

          {/* 图标网格 */}
          <div className="max-h-64 overflow-y-auto p-2">
            {loading ? (
              <div className="flex h-16 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : pageIcons.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">未找到匹配的图标</p>
            ) : (
              <>
                <div className="grid grid-cols-10 gap-0.5">
                  {pageIcons.map((icon) => {
                    const key = `${icon.prefix}:${icon.name}`;
                    const svg = faBodyCache.get(key);
                    const selected = value === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        title={key}
                        onClick={() => selectIcon(icon)}
                        className={`flex h-7 w-7 items-center justify-center rounded border transition-all ${
                          selected
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-transparent text-muted-foreground hover:border-border hover:bg-accent hover:text-foreground"
                        }`}
                      >
                        {svg ? (
                          <FaIconSvg svg={svg} size={GRID_ICON_SIZE} />
                        ) : (
                          // 图形尚未到位（或该图标不存在）时的占位
                          <span className="block h-3 w-3 rounded-sm bg-muted" aria-hidden="true" />
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* 分页导航 */}
                {totalPages > 1 && (
                  <div className="mt-2 flex items-center justify-between gap-2 px-1">
                    <button
                      type="button"
                      onClick={() => setPage(Math.max(1, page - 1))}
                      disabled={page <= 1}
                      className="h-6 rounded border px-2 text-[10px] text-muted-foreground transition-colors hover:bg-accent disabled:opacity-40"
                    >
                      上一页
                    </button>
                    <span className="text-[11px] text-muted-foreground">
                      {page}/{totalPages}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPage(Math.min(totalPages, page + 1))}
                      disabled={page >= totalPages}
                      className="h-6 rounded border px-2 text-[10px] text-muted-foreground transition-colors hover:bg-accent disabled:opacity-40"
                    >
                      下一页
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
