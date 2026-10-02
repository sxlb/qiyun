"use client";

/**
 * Iconify 图标浏览器（后台用，内联形态）
 *
 * - 可切换图标集（fa6-solid / fa6-brands / mdi / lucide / tabler / simple-icons …），
 *   覆盖原先「FontAwesome 专用选择器」的全部场景 —— FA 图标本就是 Iconify 的一个图标集
 * - 在**弹层容器内**平铺展示：图标集选择 + 搜索 + 分类筛选 + 网格 + 分页，
 *   自身不产生浮层、不依赖父级宽度，窄屏与全屏弹层下都不会溢出
 * - 图标清单来自 /api/icons（服务端代理 Iconify /collection，进程内缓存 1 小时）
 * - 图标图形按页批量拉取：一次请求取回整页 SVG body（Iconify JSON API），避免逐图请求
 * - 网格列数由容器宽度自动决定（auto-fill + minmax），网格区域自带滚动
 * - 选中值格式： "prefix:name"（如 fa6-solid:user、mdi:home）
 */

import { useState, useMemo, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Loader2, AlertCircle, ChevronLeft, ChevronRight, Check, RefreshCw } from "lucide-react";
import { useExternalApi } from "./useExternalApi";
import { EXTERNAL_API_DEFAULTS } from "@/lib/external-api";

/* ==================== 类型定义 ==================== */

interface IconEntry {
  name: string;
  category?: string;
}

interface CatalogPayload {
  prefix: string;
  title: string;
  total: number;
  categories: { name: string; count: number }[];
  icons: IconEntry[];
}

/** 单个图标的 SVG 图形数据（body 已含 fill="currentColor"） */
interface IconSvgBody {
  body: string;
  width: number;
  height: number;
}

export interface IconifyPickerProps {
  value: string;
  onChange: (value: string) => void;
}

/* ==================== 常量 ==================== */

/** 可选图标集（Iconify 收录 150+，此处只列常用集，其余可手动输入标识）
 *
 * 刻意不含 lucide：`lucide:` 属于 lib/iconValue 的保留前缀，前台会走本地白名单解析，
 * 而本地白名单只收录 163 个图标（Iconify 的 lucide 图标集有 1900+），
 * 从这里选中会得到一个「看着正常、实际渲染空白」的值。Lucide 图标请走 Lucide Tab。
 */
const ICON_SETS: { prefix: string; label: string }[] = [
  { prefix: "fa6-solid", label: "FontAwesome 6 实心" },
  { prefix: "fa6-brands", label: "FontAwesome 6 品牌" },
  { prefix: "mdi", label: "Material Design" },
  { prefix: "tabler", label: "Tabler" },
  { prefix: "simple-icons", label: "Simple Icons（品牌）" },
  { prefix: "ri", label: "Remix Icon" },
  { prefix: "ph", label: "Phosphor" },
  { prefix: "carbon", label: "Carbon" },
  { prefix: "bi", label: "Bootstrap Icons" },
  { prefix: "material-symbols", label: "Material Symbols" },
];

const DEFAULT_PREFIX = "fa6-solid";
const SEARCH_DEBOUNCE_MS = 200;
const ITEMS_PER_PAGE = 80;
/** 单次批量请求的图标个数（控制 URL 长度） */
const CHUNK_SIZE = 48;
/** 网格内图标显示尺寸（px） */
const GRID_ICON_SIZE = 16;

/**
 * 图标排序：字母序，但把「以数字开头」的名字排到最后。
 *
 * 各图标集都存在 0-9、1password 这类数字开头命名（fa6-solid 有 10 个、simple-icons 有 300+），
 * 字母序下它们会挤占首屏，而这类图标几乎不会是管理员想找的。
 * 不做「优先分类」处理：各图标集分类命名差异极大（Objects / Users & People / Transportation + Road …），
 * 维护一份跨集通用的优先表不现实。
 */
function compareIcons(a: IconEntry, b: IconEntry): number {
  const na = /^\d/.test(a.name) ? 1 : 0;
  const nb = /^\d/.test(b.name) ? 1 : 0;
  if (na !== nb) return na - nb;
  return a.name.localeCompare(b.name);
}

/** 选中值解析：prefix:name */
const VALUE_RE = /^([a-z0-9]+(?:-[a-z0-9]+)*):(.+)$/i;

/* ==================== 模块级缓存 ==================== */

/**
 * 图标 SVG 缓存（key = "prefix:name"）。
 * 值为 null 表示该图标不存在或加载失败，用于避免重复请求。
 */
const svgBodyCache = new Map<string, IconSvgBody | null>();
/** 正在进行中的请求 key 集合（并发去重） */
const inflight = new Set<string>();

/** 轻量清洗：Iconify 返回的 body 只应是 path/g 等图形元素，剔除脚本与内联事件做防御性处理 */
function sanitizeBody(body: string): string {
  return body
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

/**
 * 批量拉取图标 SVG body 并写入模块级缓存。
 * 按 prefix 分组、再按 CHUNK_SIZE 分片，每片一次请求；完成后回调 onUpdate 触发重渲染。
 *
 * 失败处理（重要）：
 * 请求失败**不写入 null 缓存**。第三方图标源不可用绝大多数是暂时性的（网络抖动 / 源被墙），
 * 写 null 会让这批图标在整页生命周期内永久显示为空白且无法重试 —— 用户看到的是「一片空白
 * 的网格，且没有任何提示」。这里改为通过 onError 上报失败，由组件显示可见的错误提示与
 * 「重试」按钮；重试时这些图标因为没被缓存，会重新发起请求。
 * 与之相对，「请求成功但该图标不存在」（Iconify 未返回该 name）才写 null，避免反复请求不存在的图标。
 *
 * @param apiBase Iconify API 基地址（后台「外部服务」配置，便于换源 / 走镜像）
 * @param onError 某个图标集整批加载失败时回调（用于界面提示 + 重试）
 */
async function loadBodies(
  icons: { prefix: string; name: string }[],
  onUpdate: () => void,
  apiBase: string,
  onError?: (prefix: string) => void
): Promise<void> {
  const byPrefix = new Map<string, string[]>();

  for (const icon of icons) {
    const key = `${icon.prefix}:${icon.name}`;
    if (svgBodyCache.has(key) || inflight.has(key)) continue;
    inflight.add(key);
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
            const res = await fetch(`${apiBase}/${prefix}.json?icons=${query}`, {
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
              svgBodyCache.set(
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
            console.error("[IconifyPicker] 批量加载图标失败:", prefix, err);
            // 刻意不写 null：见函数头说明，避免暂时性故障被固化成「永久空白 + 无提示」
            onError?.(prefix);
          } finally {
            for (const name of chunk) inflight.delete(`${prefix}:${name}`);
          }
        })()
      );
    }
  }

  await Promise.all(jobs);
  onUpdate();
}

/** 渲染一个已缓存的图标 SVG */
function IconSvg({ svg, size }: { svg: IconSvgBody; size: number }) {
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

export default function IconifyPicker({ value, onChange }: IconifyPickerProps) {
  // Iconify API 基地址（后台「外部服务」配置；空串时回退内置默认）
  const externalApi = useExternalApi();
  const iconifyApi = externalApi.iconifyApi || EXTERNAL_API_DEFAULTS.iconifyApi;

  const [prefix, setPrefix] = useState<string>(() => VALUE_RE.exec(value)?.[1]?.toLowerCase() || DEFAULT_PREFIX);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [catalog, setCatalog] = useState<CatalogPayload | null>(null);
  /** 仅用于在批量 SVG 到位后触发重渲染（缓存本身在模块级 Map 中） */
  const [bodyVersion, setBodyVersion] = useState(0);
  /** 图形加载失败的图标集（用于显示可见提示；空数组表示无失败） */
  const [failedPrefixes, setFailedPrefixes] = useState<string[]>([]);
  /** 手动重试计数：作为加载 effect 的依赖，触发重新请求（失败项未被缓存） */
  const [reloadKey, setReloadKey] = useState(0);

  const bumpBodyVersion = () => setBodyVersion((v) => v + 1);

  /** 某个图标集整批加载失败：记录用于界面提示（去重，避免多次分片失败刷屏） */
  const handleLoadError = useCallback((failed: string) => {
    setFailedPrefixes((prev) => (prev.includes(failed) ? prev : [...prev, failed]));
  }, []);

  /** 重试：清空失败标记并重新触发图形加载 */
  const retryLoadBodies = () => {
    setFailedPrefixes([]);
    setReloadKey((k) => k + 1);
  };

  // 挂载 / 切换图标集时拉取目录（本组件只在图层面板可见时挂载，故无需额外开关判断）
  useEffect(() => {
    if (!prefix) return;
    let cancelled = false;
    setLoading(true);
    setErrorMsg("");

    fetch(`/api/icons?prefix=${encodeURIComponent(prefix)}`)
      .then(async (res) => {
        const data = (await res.json()) as CatalogPayload & { error?: string };
        if (cancelled) return;
        if (!res.ok) {
          setCatalog(null);
          setErrorMsg(data.error || "图标集加载失败");
          return;
        }
        setCatalog(data);
      })
      .catch(() => {
        if (cancelled) return;
        setCatalog(null);
        setErrorMsg("图标集加载失败，请检查网络连接");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [prefix]);

  // 搜索防抖
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  // 图标集 / 搜索词 / 分类变化时回到第 1 页
  useEffect(() => {
    setPage(1);
  }, [prefix, debouncedSearch, categoryFilter]);

  // 切换图标集时重置分类筛选（分类名在不同图标集间不通用）
  useEffect(() => {
    setCategoryFilter("all");
  }, [prefix]);

  // 过滤 + 排序
  const filteredIcons = useMemo(() => {
    const icons = catalog?.icons ?? [];
    let result = icons;

    if (categoryFilter !== "all") {
      result = result.filter((i) => i.category === categoryFilter);
    }
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      result = result.filter((i) => i.name.toLowerCase().includes(q));
    }

    // 数字开头排后，其余字母序
    return [...result].sort(compareIcons);
  }, [catalog, debouncedSearch, categoryFilter]);

  // 分页
  const totalPages = Math.max(1, Math.ceil(filteredIcons.length / ITEMS_PER_PAGE));
  const pageStart = (page - 1) * ITEMS_PER_PAGE;
  const pageIcons = filteredIcons.slice(pageStart, pageStart + ITEMS_PER_PAGE);

  // 当前页图标集合的稳定 key：作为批量加载的依赖，避免数组引用变化导致重复请求
  const pageKey = pageIcons.map((i) => `${prefix}:${i.name}`).join(",");

  // 批量加载当前页图标图形（reloadKey 变化 => 用户点了「重试」）
  useEffect(() => {
    if (!pageKey) return;
    let cancelled = false;
    void loadBodies(
      pageIcons.map((i) => ({ prefix, name: i.name })),
      () => {
        if (!cancelled) bumpBodyVersion();
      },
      iconifyApi,
      (failed) => {
        if (!cancelled) handleLoadError(failed);
      }
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey, iconifyApi, reloadKey]);

  // 选中值变化时确保其图形已缓存（用于网格选中态旁的小预览）
  useEffect(() => {
    const m = VALUE_RE.exec(value);
    if (!m) return;
    void loadBodies([{ prefix: m[1].toLowerCase(), name: m[2] }], bumpBodyVersion, iconifyApi, handleLoadError);
  }, [value, iconifyApi, handleLoadError]);

  // 引用 bodyVersion：让「缓存写入」能驱动重渲染
  void bodyVersion;

  /** 当前图标集是否加载失败（用于提示 + 重试） */
  const loadFailed = failedPrefixes.includes(prefix);

  return (
    <div className="space-y-3">
      {/* 图标集 + 搜索：窄屏堆叠、宽屏并排，避免固定宽度导致横向溢出 */}
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <label className="flex min-w-0 flex-col gap-1">
          <span className="sr-only">图标集</span>
          <select
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {ICON_SETS.map((s) => (
              <option key={s.prefix} value={s.prefix}>
                {s.label}（{s.prefix}）
              </option>
            ))}
            {/* 当前值来自非预设图标集时，补一个选项避免下拉框显示错位 */}
            {!ICON_SETS.some((s) => s.prefix === prefix) && <option value={prefix}>{prefix}</option>}
          </select>
        </label>
        <div className="relative min-w-0">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索图标名称（如 github、cart、bell）"
            spellCheck={false}
            autoComplete="off"
            className="h-10 pl-9 text-sm"
          />
        </div>
      </div>

      {/* 分类筛选：分类有几十个，横向胶囊条既看不全、也没有滚动提示（滚动条是隐藏的），
          所以各端统一改用原生下拉 —— 分类全在列表里，系统选择器自带滚动与检索，
          与上方「图标集」字段的下拉风格也一致。 */}
      {catalog && catalog.categories.length > 0 && (
        <>
          <label htmlFor="iconify-category" className="sr-only">
            图标分类
          </label>
          <select
            id="iconify-category"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="all">全部（{catalog.total}）</option>
            {catalog.categories.map((cat) => (
              <option key={cat.name} value={cat.name}>
                {cat.name}（{cat.count}）
              </option>
            ))}
            {/* 当前分类不属于该图标集时补一个选项，避免下拉框显示空白 */}
            {categoryFilter !== "all" &&
              !catalog.categories.some((cat) => cat.name === categoryFilter) && (
                <option value={categoryFilter}>{categoryFilter}</option>
              )}
          </select>
        </>
      )}

      <p className="text-xs text-muted-foreground">
        {catalog ? `当前图标集共 ${catalog.total} 个` : "正在读取图标集…"}
        {debouncedSearch && `；筛选后 ${filteredIcons.length} 个`}
      </p>

      {/* 图标网格 */}
      <div className="rounded-lg border border-border/60 bg-muted/20 p-2">
        {/* 图标源不可用时的可见提示：原先失败只写 console.error 并缓存 null，
            界面呈现为「一整片空白方格且没有任何说明」，用户无从判断是加载中还是坏了 */}
        {loadFailed && (
          <div className="mb-2 flex items-start justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2">
            <span className="flex min-w-0 items-start gap-1.5 text-xs leading-relaxed text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 break-all">
                图标图形加载失败：无法访问 Iconify 源（{iconifyApi}）。图标清单可用，但图形需连外网；
                可在「外部服务」面板更换图标源地址后点「重试」。
              </span>
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={retryLoadBodies}
              className="h-7 shrink-0 gap-1 px-2 text-xs"
            >
              <RefreshCw className="h-3 w-3" />
              重试
            </Button>
          </div>
        )}
        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : errorMsg ? (
          <p className="flex h-40 flex-col items-center justify-center gap-2 text-center text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            {errorMsg}
          </p>
        ) : pageIcons.length === 0 ? (
          <p className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            未找到匹配的图标
          </p>
        ) : (
          <>
            <div className="grid max-h-[40vh] grid-cols-[repeat(auto-fill,minmax(2.5rem,1fr))] gap-1.5 overflow-y-auto">
              {pageIcons.map((icon) => {
                const key = `${prefix}:${icon.name}`;
                const svg = svgBodyCache.get(key);
                const selected = value === key;
                return (
                  <button
                    key={key}
                    type="button"
                    title={key}
                    aria-label={key}
                    aria-pressed={selected}
                    onClick={() => onChange(key)}
                    className={`relative flex aspect-square items-center justify-center rounded-md border transition-colors ${
                      selected
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-transparent text-muted-foreground hover:border-border hover:bg-accent hover:text-foreground"
                    }`}
                  >
                    {svg ? (
                      <IconSvg svg={svg} size={GRID_ICON_SIZE} />
                    ) : (
                      // 图形尚未到位（或该图标不存在）时的占位
                      <span className="block h-4 w-4 rounded-sm bg-muted-foreground/15" aria-hidden="true" />
                    )}
                    {selected && (
                      <span className="absolute right-0.5 top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Check className="h-2.5 w-2.5" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* 分页导航 */}
            {totalPages > 1 && (
              <div className="mt-3 flex items-center justify-between gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage(Math.max(1, page - 1))}
                  className="gap-1"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  上一页
                </Button>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {page} / {totalPages}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={page >= totalPages || loading}
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                  className="gap-1"
                >
                  下一页
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
