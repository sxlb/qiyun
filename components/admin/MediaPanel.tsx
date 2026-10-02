"use client";

import { useEffect, useRef, useState } from "react";
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
} from "lucide-react";
import { PanelHeader, EmptyState } from "./panel";
import { useDataFetcher } from "./useDataFetcher";

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

  // 列表 / 总数 / 当前页均以服务端返回为准
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const page = data?.page ?? 1;

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
                className="group overflow-hidden rounded-xl border border-border bg-background transition-all hover:shadow-md"
              >
                <button
                  onClick={() => setPreviewUrl(item.url)}
                  className="relative block w-full cursor-zoom-in bg-muted"
                  aria-label={`预览 ${item.fileName}`}
                >
                  {/* 后台内部图像经 /api/uploads|wallpaper 动态路由提供，走 next/image 优化无公开收益且多一层回源风险，故用原生 img */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.url}
                    alt={item.fileName}
                    loading="lazy"
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
              className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}