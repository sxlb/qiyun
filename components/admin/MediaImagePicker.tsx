"use client";

/**
 * 媒体库图片选择器（后台通用）
 *
 * 与 MediaPicker（图标选择器）的分工：
 * - MediaPicker：图标值（lucide / Iconify / 内联 SVG / 外链）
 * - 本组件：媒体库里已上传的**位图**，用于背景壁纸、封面等需要「选一张图」的场景
 *
 * 数据源与「媒体库」面板同源（GET /api/media），因此后台任意面板上传过的图片
 * 都会出现在这里。弹层在打开时才挂载，每次打开都是一次全新请求，拿到最新列表。
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Image as ImageIcon,
  X,
  Check,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { EmptyState } from "./panel";
import { useDataFetcher } from "./useDataFetcher";

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

const PAGE_SIZE = 24;

/** 选择弹层：分页浏览媒体库，点击图片即选中并关闭 */
function MediaPickerDialog({
  selected,
  onSelect,
  onClose,
}: {
  selected: string;
  onSelect: (url: string) => void;
  onClose: () => void;
}) {
  const [page, setPage] = useState(1);
  const { data, loading, run } = useDataFetcher<MediaPage, [number]>(
    (p) => fetch(`/api/media?page=${p}&pageSize=${PAGE_SIZE}`),
    { initialArgs: [1], notOkMessage: "加载媒体失败", networkMessage: "网络错误" }
  );

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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="从媒体库选择图片"
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm sm:p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <ImageIcon className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">从媒体库选择</span>
            <span className="text-xs text-muted-foreground">共 {total} 张</span>
          </div>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="关闭"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
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
                    className={`group relative overflow-hidden rounded-lg border transition-all ${
                      active
                        ? "border-primary ring-2 ring-primary/40"
                        : "border-border hover:border-primary/50"
                    }`}
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
          )}
        </div>

        {totalPages > 1 && (
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
  label = "媒体库",
}: {
  /** 当前值：用于在网格中高亮已选中的那张 */
  value?: string;
  /** 选中回调，参数为图片地址（如 /api/uploads/file/xxx.png） */
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
