"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import {
  Upload,
  RefreshCw,
  Loader2,
  Copy,
  CopyPlus,
  Trash2,
  Image as ImageIcon,
  Eye,
  X,
  ChevronDown,
  ChevronRight,
  HardDrive,
} from "lucide-react";
import { PanelHeader, EmptyState } from "./panel";
import { useDataFetcher } from "./useDataFetcher";
import { groupCachedWallpapers, cacheTagLabel, type WallpaperCacheTag } from "@/lib/wallpaperTags";
import { gridThumbAttrs } from "@/lib/mediaThumb";

interface ImageAsset {
  id: number;
  url: string;
  fileName: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
  usage: string;
  createdAt: string;
}

const USAGE_LABEL: Record<string, string> = {
  "": "全部类型",
  avatar: "头像",
  siteicon: "站点图标",
  link: "链接图",
  wallpaper: "壁纸",
  logo: "Logo",
};

/** GET /api/media 的分页响应 */
interface MediaPage {
  items: ImageAsset[];
  total: number;
  page: number;
}

const PAGE_SIZE = 24;

/**
 * 壁纸缓存条目（GET /api/wallpaper/cache）。
 * 与 ImageAsset 是两套东西：这些是自动从壁纸源下载的本地缓存，不登记数据库，
 * 会被自动裁剪，因此单独一个只读分区展示。
 */
interface CachedWallpaper {
  fileName: string;
  url: string;
  sourceUrl: string;
  addedAt: number;
  size: number;
  tag: WallpaperCacheTag | null;
  exists: boolean;
}

interface CacheBudgetUsage {
  key: string;
  label: string;
  count: number;
  max: number;
  bytes: number;
}

interface CacheOverview {
  items: CachedWallpaper[];
  total: number;
  bytes: number;
  max: number;
  /** 本地缓存「够用」阈值（张）：达到后前台只读本地 */
  readyThreshold: number;
  /** 按预算组拆分的用量（电脑 / 手机 / 必应共享） */
  budgets: CacheBudgetUsage[];
}

function formatBytes(n: number): string {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function MediaPanel() {
  const [usage, setUsage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // 壁纸缓存分区：默认折叠。缓存最多上百张，全量渲染没必要，折叠状态只显示汇总
  const [cacheOpen, setCacheOpen] = useState(false);
  const [cacheConfirming, setCacheConfirming] = useState<string | null>(null);
  const [cacheClearing, setCacheClearing] = useState(false);
  const [cacheBusy, setCacheBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 预览弹层：用于把焦点移入关闭按钮，保证键盘可达
  const previewCloseRef = useRef<HTMLButtonElement>(null);

  const { data, loading, run } = useDataFetcher<MediaPage, [number, string]>(
    (p, u) => {
      const params = new URLSearchParams();
      if (u) params.set("usage", u);
      params.set("page", String(p));
      params.set("pageSize", String(PAGE_SIZE));
      return fetch(`/api/media?${params.toString()}`);
    },
    { initialArgs: [1, ""], notOkMessage: "加载媒体失败", networkMessage: "网络错误" }
  );

  // 壁纸缓存与媒体库分属两套数据源，各自独立请求（缓存量小、不分页）
  const { data: cache, loading: cacheLoading, run: loadCache } = useDataFetcher<CacheOverview, []>(
    () => fetch("/api/wallpaper/cache"),
    { initialArgs: [], notOkMessage: "加载壁纸缓存失败", networkMessage: "网络错误" }
  );

  // 列表 / 总数 / 当前页均以服务端返回为准
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const page = data?.page ?? 1;

  // 壁纸缓存按「预算组 → 来源」两级归类。平铺时每张只在角上标个 anime:pc，
  // 既看不出占的是哪台设备的额度，也看不出题材；归类后先按电脑/手机/必应共享分段。
  const cacheGroups = useMemo(() => groupCachedWallpapers(cache?.items ?? []), [cache]);

  // 删除最后一张后当前页可能越界（total 已变小，但服务端原样回显旧页码）：
  // 此时会出现「共 24 个媒体资产 / 2 / 1」且列表空白的自相矛盾状态。
  // 条件用 page > lastPage（保证目标页更小）而不是「列表为空」，避免接口异常时来回请求。
  useEffect(() => {
    if (!data) return;
    const lastPage = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
    if (data.items.length === 0 && data.page > lastPage) void run(lastPage, usage);
  }, [data, run, usage]);

  // 预览弹层键盘支持：打开时焦点移入关闭按钮，Esc 关闭。
  // 此前只能点击遮罩/按钮关闭，键盘用户无法退出预览。
  useEffect(() => {
    if (!previewUrl) return;
    previewCloseRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreviewUrl(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [previewUrl]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(true);
    let ok = 0;
    try {
      for (const file of list) {
        const fd = new FormData();
        fd.append("file", file);
        if (usage) fd.append("usage", usage);
        const res = await fetch("/api/media", { method: "POST", body: fd });
        if (res.ok) ok += 1;
      }
      if (ok === list.length) toast.success(`已上传 ${ok} 张图片`);
      else if (ok > 0) toast.success(`上传完成：${ok}/${list.length} 成功，其余失败`);
      else toast.error("上传失败，请检查文件是否为支持格式（≤10MB）");
    } catch {
      toast.error("上传失败");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      run(1, usage);
    }
  }

  async function copyAsset(item: ImageAsset) {
    try {
      const res = await fetch(`/api/media/${item.id}/copy`, { method: "POST" });
      const d = await res.json().catch(() => null);
      if (res.ok) {
        toast.success("已复制");
        run(page, usage);
      } else {
        toast.error(d?.error || "复制失败");
      }
    } catch {
      toast.error("复制失败");
    }
  }

  async function deleteAsset(item: ImageAsset) {
    setConfirmingId(null);
    try {
      const res = await fetch(`/api/media/${item.id}`, { method: "DELETE" });
      const d = await res.json().catch(() => null);
      if (res.ok) toast.success("已删除");
      else toast.error(d?.error || "删除失败");
    } catch {
      toast.error("删除失败");
    } finally {
      run(page, usage);
    }
  }

  async function deleteCacheItem(fileName: string) {
    setCacheBusy(true);
    try {
      const res = await fetch(`/api/wallpaper/cache?fileName=${encodeURIComponent(fileName)}`, {
        method: "DELETE",
      });
      const d = await res.json().catch(() => null);
      if (res.ok) toast.success("已删除该缓存");
      else toast.error(d?.error || "删除失败");
    } catch {
      toast.error("删除失败");
    } finally {
      setCacheConfirming(null);
      setCacheBusy(false);
      void loadCache();
    }
  }

  async function clearCache() {
    setCacheBusy(true);
    try {
      const res = await fetch("/api/wallpaper/cache?all=1", { method: "DELETE" });
      const d = await res.json().catch(() => null);
      if (res.ok) toast.success(`已清空 ${d?.removed ?? 0} 张缓存`);
      else toast.error(d?.error || "清空失败");
    } catch {
      toast.error("清空失败");
    } finally {
      setCacheClearing(false);
      setCacheBusy(false);
      void loadCache();
    }
  }

  async function copyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("URL 已复制");
    } catch {
      toast.error("复制失败");
    }
  }

  return (
    <Card>
      <CardContent>
        <div className="mb-3">
          <PanelHeader
            actions={
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => e.target.files && uploadFiles(e.target.files)}
                />
                <Button size="sm" variant="outline" onClick={() => run(page, usage)} disabled={loading} className="gap-1.5">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  刷新
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="gap-1.5"
                >
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {uploading ? "上传中..." : "上传图片"}
                </Button>
              </>
            }
          />
        </div>

        {/* 类型过滤 */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {Object.entries(USAGE_LABEL).map(([key, label]) => (
            <button
              key={key}
              onClick={() => {
                setUsage(key);
                run(1, key);
              }}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                usage === key
                  ? "bg-primary/10 font-medium text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            加载中...
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={<ImageIcon className="h-5 w-5" />} title="暂无媒体" hint="点击右上角「上传图片」添加，或切换类型筛选" />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((item) => (
              <div
                key={item.id}
                className="media-grid-cell group overflow-hidden rounded-xl border border-border bg-background transition-all hover:shadow-md"
              >
                <button
                  onClick={() => setPreviewUrl(item.url)}
                  className="relative block w-full cursor-zoom-in bg-muted"
                  aria-label={`预览 ${item.fileName}`}
                >
                  {/* 后台内部图像经 /api/uploads|wallpaper 动态路由提供，走 next/image 优化无公开收益且多一层回源风险，故用原生 img */}
                  {/* gridThumbAttrs 让网格请求 ?w=320/640 的缩略图（含高分屏 2x），避免原图直出 */}
                  {/* decoding=async 让解码在后台线程进行；fetchPriority=low 让缩略图给同页接口请求让路 ——
                      否则一批大图会占满浏览器连接池，分页 / 筛选请求排在后面，表现为「图片没加载完就一直卡」 */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    {...gridThumbAttrs(item.url)}
                    alt={item.fileName}
                    loading="lazy"
                    decoding="async"
                    fetchPriority="low"
                    className="aspect-square w-full object-cover"
                  />
                  <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md bg-black/40 text-white opacity-0 backdrop-blur transition-opacity group-hover:opacity-100">
                    <Eye className="h-3.5 w-3.5" />
                  </span>
                </button>

                <div className="space-y-2 p-3">
                  <p className="truncate text-xs font-medium text-foreground" title={item.fileName}>
                    {item.fileName}
                  </p>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{formatBytes(item.size)}</span>
                    <span>
                      {item.width && item.height ? `${item.width}×${item.height}` : "—"}
                    </span>
                  </div>

                  {confirmingId === item.id ? (
                    <div className="flex items-center gap-1.5">
                      <Button size="sm" variant="destructive" className="h-7 flex-1 text-xs" onClick={() => deleteAsset(item)}>
                        <Trash2 className="h-3 w-3" />
                        确认删除
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setConfirmingId(null)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <Button size="sm" variant="ghost" className="h-7 flex-1 text-xs" onClick={() => copyUrl(item.url)}>
                        <Copy className="h-3 w-3" />
                        复制URL
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-9 px-0"
                        title="复制资产"
                        onClick={() => copyAsset(item)}
                      >
                        <CopyPlus className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-9 px-0 text-destructive hover:bg-destructive/10"
                        title="删除"
                        onClick={() => setConfirmingId(item.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 分页 */}
        {total > 0 && (
          <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
            <span>共 {total} 个媒体资产</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => run(page - 1, usage)}>
                上一页
              </Button>
              <span>{page} / {totalPages}</span>
              <Button size="sm" variant="outline" disabled={page >= totalPages || loading} onClick={() => run(page + 1, usage)}>
                下一页
              </Button>
            </div>
          </div>
        )}

        {/* 壁纸缓存分区：数据源是 data/wallpapers 的 manifest，不是 ImageAsset —— 缓存会被
            自动裁剪，登记进媒体库会留下「记录还在、文件已被删」的死链接，故独立展示 */}
        <div className="mt-6 border-t border-border pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">壁纸缓存</span>
              <span className="text-xs text-muted-foreground">
                {cacheLoading && !cache
                  ? "读取中..."
                  : `已缓存 ${cache?.total ?? 0} 张 · 占用 ${formatBytes(cache?.bytes ?? 0)}`}
              </span>
              {cache && (cache.budgets?.length ?? 0) > 0 && (
                <span className="text-[11px] text-muted-foreground">
                  {(cache.budgets ?? []).map((b) => `${b.label} ${b.count}/${b.max}`).join(" · ")}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => setCacheOpen((v) => !v)}
                disabled={!cache || cache.total === 0}
              >
                {cacheOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                {cacheOpen ? "收起" : "展开查看"}
              </Button>
              {cacheClearing ? (
                <>
                  <Button size="sm" variant="destructive" className="gap-1.5" onClick={clearCache} disabled={cacheBusy}>
                    <Trash2 className="h-3.5 w-3.5" />
                    确认清空
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setCacheClearing(false)} disabled={cacheBusy}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-destructive hover:bg-destructive/10"
                  onClick={() => setCacheClearing(true)}
                  disabled={!cache || cache.total === 0 || cacheBusy}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  清空
                </Button>
              )}
            </div>
          </div>

          <p className="mt-2 text-xs text-muted-foreground">
            从壁纸源自动下载的本地背景图，前台优先取这里（源失效也能正常展示）。额度分三份：
            电脑 {cache?.max ?? 100} 张、手机 {cache?.max ?? 100} 张、必应共享 {cache?.max ?? 100} 张，
            <strong>各自填满即停止新增</strong>，不会自动删旧图。本地攒到 {cache?.readyThreshold ?? 5} 张后，
            前台只读本地、不再为了取图去请求上游；不够 {cache?.readyThreshold ?? 5} 张时会尽快补齐。
            随机壁纸源（风景 / 动漫）下，前台右键菜单可用「换一张壁纸」主动去上游取新图 ——
            额度满时替换最旧的那一张。在这里删掉后，下次访问会重新抓一张。
          </p>

          {cacheOpen && cache && cache.items.length > 0 && (
            <div className="mt-4 space-y-5">
              {cacheGroups.map((group) => (
                <div key={group.budget}>
                  {/* 一级：预算组（谁在用，决定占哪份额度） */}
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{group.label}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">{group.count} 张</span>
                    <span className="h-px flex-1 bg-border" />
                  </div>
                  <div className="space-y-3">
                    {group.sources.map((sub) => (
                      <div key={sub.source}>
                        {/* 二级：来源（图从哪来）。该预算组只有一种来源时不重复渲染标题 ——
                            卡片角标已写明来源，再加一行「必应共享 / 必应」纯属冗余 */}
                        {group.sources.length > 1 && (
                          <p className="mb-1.5 text-xs text-muted-foreground">
                            {sub.label} · {sub.items.length} 张
                          </p>
                        )}
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                          {sub.items.map((item) => (
                            <div key={item.fileName} className="media-grid-cell overflow-hidden rounded-xl border border-border bg-background">
                              <button
                                onClick={() => setPreviewUrl(item.url)}
                                disabled={!item.exists}
                                className="relative block w-full cursor-zoom-in bg-muted disabled:cursor-not-allowed"
                                aria-label={`预览 ${item.fileName}`}
                              >
                                {/* 缓存图片经 /api/wallpaper/file 动态路由提供，与媒体库同理不走 next/image */}
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  {...gridThumbAttrs(item.url)}
                                  alt={item.fileName}
                                  loading="lazy"
                                  decoding="async"
                                  fetchPriority="low"
                                  className="aspect-square w-full object-cover"
                                />
                                {!item.exists && (
                                  <span className="absolute inset-0 flex items-center justify-center bg-black/60 p-2 text-center text-[11px] text-white">
                                    文件已不在磁盘上
                                  </span>
                                )}
                              </button>

                              <div className="space-y-2 p-3">
                                <p className="truncate text-xs font-medium text-foreground" title={item.fileName}>
                                  {item.fileName}
                                </p>
                                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                                  <span>{formatBytes(item.size)}</span>
                                  <span>{cacheTagLabel(item.tag)}</span>
                                </div>

                                {cacheConfirming === item.fileName ? (
                                  <div className="flex items-center gap-1.5">
                                    <Button
                                      size="sm"
                                      variant="destructive"
                                      className="h-7 flex-1 text-xs"
                                      onClick={() => deleteCacheItem(item.fileName)}
                                      disabled={cacheBusy}
                                    >
                                      <Trash2 className="h-3 w-3" />
                                      确认删除
                                    </Button>
                                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setCacheConfirming(null)}>
                                      <X className="h-3 w-3" />
                                    </Button>
                                  </div>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 w-full text-xs text-destructive hover:bg-destructive/10"
                                    onClick={() => setCacheConfirming(item.fileName)}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                    删除
                                  </Button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 预览大图：对话框语义 + Esc 关闭 + 打开时焦点移入关闭按钮 */}
        {previewUrl && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="图片预览"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
            onClick={() => setPreviewUrl(null)}
          >
            <button
              ref={previewCloseRef}
              className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
              aria-label="关闭预览"
              onClick={() => setPreviewUrl(null)}
            >
              <X className="h-5 w-5" />
            </button>
            {/* 预览大图：object-contain 自适应，内部路由图像，不做 next/image 优化 */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt="媒体预览"
              decoding="async"
              className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}