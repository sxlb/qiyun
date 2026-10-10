"use client";

/**
 * 图片选择器（后台通用）：从「媒体库」或「壁纸缓存」里挑一张图。
 *
 * 与 MediaPicker（图标选择器）的分工：
 * - MediaPicker：图标值（lucide / Iconify / 内联 SVG / 外链），URL 页签里可打开本组件
 * - 本组件：可直接当图片展示的值，用于背景壁纸、头像、站点图标、封面、二维码等场景
 *
 * 两个来源是**两套数据源**，不是同一份数据的两种筛法：
 * - 媒体库：GET /api/media，用户上传、登记在 ImageAsset 表、分页
 * - 壁纸缓存：GET /api/wallpaper/cache，从壁纸源自动下载的本地文件、不登记数据库、会被上限裁剪
 * 因此这里按页签并列展示，而不是合并成一个列表 —— 两者的生命周期与删除入口都不同。
 *
 * 弹层在打开时才挂载，每次打开都是一次全新请求，拿到最新列表。
 */

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Image as ImageIcon,
  HardDrive,
  X,
  Check,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { EmptyState } from "./panel";
import { useDataFetcher } from "./useDataFetcher";
import {
  groupCachedWallpapers,
  cacheTagLabel,
  type WallpaperCacheTag,
} from "@/lib/wallpaperTags";

/** GET /api/media 返回的图片资产（与 MediaPanel 保持一致） */
interface ImageAsset {
  id: number;
  url: string;
  fileName: string;
  width: number;
  height: number;
}

interface MediaPage {
  items: ImageAsset[];
  total: number;
  page: number;
  pageSize: number;
}

/** GET /api/wallpaper/cache 返回的缓存条目（只取选择器用得到的字段） */
interface CachedWallpaper {
  fileName: string;
  url: string;
  size: number;
  tag: WallpaperCacheTag | null;
  exists: boolean;
}

interface CacheOverview {
  items: CachedWallpaper[];
  total: number;
}

const PAGE_SIZE = 24;

type SourceTab = "media" | "wallpaper";

const TABS: { id: SourceTab; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "media", label: "媒体库", Icon: ImageIcon },
  { id: "wallpaper", label: "壁纸缓存", Icon: HardDrive },
];

/** 选择弹层：按来源分页 / 分组浏览，点击图片即选中并关闭 */
function MediaPickerDialog({
  selected,
  onSelect,
  onClose,
}: {
  selected: string;
  onSelect: (url: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<SourceTab>("media");
  const [page, setPage] = useState(1);

  const { data, loading, run } = useDataFetcher<MediaPage, [number]>(
    (p) => fetch(`/api/media?page=${p}&pageSize=${PAGE_SIZE}`),
    { initialArgs: [1], notOkMessage: "加载媒体失败", networkMessage: "网络错误" }
  );

  // 缓存清单只有一份（不分页），打开弹层即取：切到该页签时无需再等一次加载
  const { data: cache, loading: cacheLoading } = useDataFetcher<CacheOverview, []>(
    () => fetch("/api/wallpaper/cache"),
    { initialArgs: [], notOkMessage: "加载壁纸缓存失败", networkMessage: "网络错误" }
  );

  // 与「媒体库」面板同一套两级归类（预算组 → 来源），避免同一批图在两个界面里分法不同
  const cacheGroups = useMemo(() => groupCachedWallpapers(cache?.items ?? []), [cache]);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // ESC 关闭弹层（与后台其它弹层保持一致的键盘可达性）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const goto = (p: number) => {
    if (p < 1 || p > totalPages || p === page) return;
    setPage(p);
    void run(p);
  };

  /** 网格单元：选中态高亮 + 勾选角标 */
  const cellClass = (active: boolean) =>
    `group relative overflow-hidden rounded-lg border transition-all ${
      active ? "border-primary ring-2 ring-primary/40" : "border-border hover:border-primary/50"
    }`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="选择图片"
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm sm:p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-sm font-medium">选择图片</span>
            <span className="truncate text-xs text-muted-foreground">
              {tab === "media"
                ? `媒体库 ${total} 张`
                : `壁纸缓存 ${cache?.total ?? 0} 张`}
            </span>
          </div>
          <button
            type="button"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="关闭"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 来源页签：两等分，避免在窄屏换行 */}
        <div className="shrink-0 border-b border-border px-3 py-2">
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted/50 p-1">
            {TABS.map((t) => {
              const Icon = t.Icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  aria-pressed={active}
                  className={`flex min-w-0 items-center justify-center gap-1.5 rounded-md px-1 py-2 text-xs transition-colors ${
                    active
                      ? "bg-background font-medium text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{t.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {tab === "media" ? (
            loading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                加载中...
              </div>
            ) : items.length === 0 ? (
              <EmptyState
                icon={<ImageIcon className="h-5 w-5" />}
                title="媒体库暂无图片"
                hint="请先在「媒体库」面板上传，或使用旁边的「上传」按钮"
              />
            ) : (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
                {items.map((item) => {
                  const active = item.url === selected;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      title={item.fileName}
                      onClick={() => {
                        onSelect(item.url);
                        onClose();
                      }}
                      className={cellClass(active)}
                    >
                      {/* 后台内部图像经 /api/uploads 动态路由提供，走 next/image 无公开收益，故用原生 img */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.url}
                        alt={item.fileName}
                        loading="lazy"
                        className="aspect-square w-full object-cover"
                      />
                      {active && (
                        <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                          <Check className="h-3 w-3" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )
          ) : cacheLoading && !cache ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              加载中...
            </div>
          ) : (cache?.items.length ?? 0) === 0 ? (
            <EmptyState
              icon={<HardDrive className="h-5 w-5" />}
              title="壁纸缓存为空"
              hint="缓存由前台访问时自动从壁纸源下载，也可在「媒体库 → 壁纸缓存」里查看"
            />
          ) : (
            <div className="space-y-4">
              {cacheGroups.map((group) => (
                <div key={group.budget}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-xs font-medium text-foreground">{group.label}</span>
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {group.count} 张
                    </span>
                    <span className="h-px flex-1 bg-border" />
                  </div>
                  <div className="space-y-3">
                    {group.sources.map((sub) => (
                      <div key={sub.source}>
                        {/* 该预算组只有一种来源时不重复标题：卡片角标已写明来源 */}
                        {group.sources.length > 1 && (
                          <p className="mb-1.5 text-[11px] text-muted-foreground">
                            {sub.label} · {sub.items.length} 张
                          </p>
                        )}
                        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
                          {sub.items.map((item) => {
                            const active = item.url === selected;
                            return (
                              <button
                                key={item.fileName}
                                type="button"
                                // 角标写明来源与设备，选壁纸时「横图还是竖图」是关键信息
                                title={`${item.fileName}（${cacheTagLabel(item.tag)}）`}
                                disabled={!item.exists}
                                onClick={() => {
                                  onSelect(item.url);
                                  onClose();
                                }}
                                className={`${cellClass(active)} disabled:cursor-not-allowed disabled:opacity-50`}
                              >
                                {/* 缓存图片经 /api/wallpaper/file 动态路由提供，与媒体库同理不走 next/image */}
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={item.url}
                                  alt={item.fileName}
                                  loading="lazy"
                                  className="aspect-square w-full object-cover"
                                />
                                {!item.exists && (
                                  <span className="absolute inset-0 flex items-center justify-center bg-black/60 p-1 text-center text-[10px] text-white">
                                    文件已不在磁盘上
                                  </span>
                                )}
                                {active && (
                                  <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                                    <Check className="h-3 w-3" />
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {tab === "media" && totalPages > 1 && (
          <div className="flex shrink-0 items-center justify-between border-t border-border px-4 py-2.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page <= 1 || loading}
              onClick={() => goto(page - 1)}
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
              onClick={() => goto(page + 1)}
              className="gap-1"
            >
              下一页
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function MediaImagePicker({
  value = "",
  onSelect,
  label = "选择图片",
}: {
  /** 当前值：用于在网格中高亮已选中的那张 */
  value?: string;
  /** 选中回调，参数为图片地址（如 /api/uploads/file/xxx.png、/api/wallpaper/file/xxx.webp） */
  onSelect: (url: string) => void;
  /** 触发按钮文案 */
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        className="shrink-0 gap-1.5"
      >
        <ImageIcon className="h-3.5 w-3.5" />
        {label}
      </Button>
      {open && (
        <MediaPickerDialog
          selected={value}
          onSelect={onSelect}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}