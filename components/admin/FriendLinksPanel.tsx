"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Trash2, Loader2, GripVertical, Users, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useListCrud, CrudItem } from "./useListCrud";
import { PanelHeader, EmptyState, PanelLoading } from "./panel";
import MediaPicker from "./MediaPicker";

interface FriendLinkItem extends CrudItem {
  name: string;
  url: string;
  icon: string;
  description: string;
  sort: number;
}

const FRIEND_LINK_URL_PATTERN = /^https?:\/\//;

/** URL 协议逐行校验器 */
function makeFriendUrlValidator(pattern: RegExp) {
  return (link: FriendLinkItem, row: number): string | null => {
    if (!link.url?.trim()) return null;
    if (!pattern.test(link.url.trim())) return `第 ${row} 行：链接格式不合法（请检查协议头）`;
    return null;
  };
}

/**
 * 友情链接管理面板：
 * - 增/删/改单行 + 批量保存（useLinkList 统一状态管理，并自行注册进全局保存）
 * - 字段：网站名称、网站地址、Logo URL、描述、排序
 */
export default function FriendLinksPanel() {
  const { items: links, loading, saving, dirty, addItem, removeItem, update: updateItem, save } = useListCrud<FriendLinkItem>({
    id: "/api/friend-links",
    label: "友情链接",
    api: "/api/friend-links",
    makeEmpty: (index) => ({
      name: "",
      url: "",
      icon: "",
      description: "",
      sort: index,
    }),
    isSubmittable: (l) => l.name.trim() !== "",
    rowValidators: [makeFriendUrlValidator(FRIEND_LINK_URL_PATTERN)],
    successMessage: () => "友情链接保存成功",
    loadError: "加载失败",
    saveError: "保存失败",
  });

  // 「从网站获取」探测中的行号（-1 表示无）
  const [fetchingIconIndex, setFetchingIconIndex] = useState(-1);

  /** 从网站地址自动探测图标（服务端依次尝试多个可用图源） */
  const handleFetchIcon = async (index: number, url: string) => {
    const target = (url || "").trim();
    if (!target) {
      toast.error("请先填写网站地址");
      return;
    }
    setFetchingIconIndex(index);
    try {
      const res = await fetch(`/api/favicon?url=${encodeURIComponent(target)}`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok && data.url) {
        updateItem(index, "icon", data.url);
        toast.success(`已获取网站图标（来源：${data.source}）`);
      } else {
        toast.error(data?.error || "未能获取网站图标，请手动填写");
      }
    } catch {
      toast.error("网络错误，获取图标失败");
    } finally {
      setFetchingIconIndex(-1);
    }
  };

  if (loading) {
    return <PanelLoading />;
  }

  return (
    <Card>
      <CardContent className="space-y-3">
        {/* 页面级标题/描述由 admin/page.tsx 提供，卡内仅保留右侧主操作区 */}
        <PanelHeader
          actions={
            <Button size="sm" onClick={addItem} className="gap-1.5">
              <Plus className="h-4 w-4" />
              添加链接
            </Button>
          }
        />
        {links.length === 0 && (
          <EmptyState
            icon={<Users className="h-5 w-5" />}
            title="暂无友情链接，点击右上角「添加链接」创建"
          />
        )}
        {links.map((link, index) => (
          <div
            key={link.id ?? link.clientId ?? index}
            className="group relative rounded-xl border bg-card transition-all hover:border-primary/30 hover:shadow-sm"
          >
            {/* 拖拽手柄 + 序号：≥sm 占左侧固定栏；移动端收进表单首行，避免吃掉 48px 宽度 */}
            <div title="按「排序」数值排列" className="absolute left-0 top-0 hidden h-full w-10 flex-col items-center justify-center gap-1 border-r border-border/50 bg-muted/30 text-muted-foreground/60 transition-colors group-hover:text-muted-foreground sm:flex">
              <GripVertical className="h-4 w-4" />
              <span className="text-[10px] font-semibold tabular-nums">{String(index + 1).padStart(2, "0")}</span>
            </div>

            {/* 删除按钮：≥sm 为悬停显示的角标图标按钮；移动端改用下方首行的带文字按钮 */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => removeItem(index)}
              className="absolute right-2 top-2 hidden h-7 w-7 text-muted-foreground transition-all hover:bg-destructive/10 hover:text-destructive sm:flex sm:opacity-0 sm:group-hover:opacity-100"
              aria-label="删除"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>

            {/* 表单内容 - ≥sm 左侧留出拖拽手柄空间 */}
            <div className="space-y-3 px-3 py-3.5 sm:space-y-2.5 sm:pl-12 sm:pr-3 sm:py-3">
              {/* 移动端首行：序号 + 删除（图标按钮太小，换成带文字按钮） */}
              <div className="flex items-center justify-between gap-2 sm:hidden">
                <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-muted px-1.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeItem(index)}
                  className="h-8 gap-1 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                  aria-label="删除"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  删除
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 sm:gap-2.5">
                <div className="space-y-1.5">
                  <Label htmlFor={`friend-name-${index}`} className="text-xs font-medium text-muted-foreground">网站名称</Label>
                  <Input
                    id={`friend-name-${index}`}
                    name={`friend-name-${index}`}
                    value={link.name}
                    onChange={(e) => updateItem(index, "name", e.target.value)}
                    placeholder="如 某某博客"
                    className="h-10 sm:h-8"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`friend-sort-${index}`} className="text-xs font-medium text-muted-foreground">排序</Label>
                  <Input
                    id={`friend-sort-${index}`}
                    name={`friend-sort-${index}`}
                    type="number"
                    min={0}
                    step={1}
                    value={link.sort}
                    onChange={(e) => updateItem(index, "sort", e.target.value === "" ? 0 : Number(e.target.value))}
                    className="h-10 sm:h-8"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`friend-url-${index}`} className="text-xs font-medium text-muted-foreground">网站地址</Label>
                <Input
                  id={`friend-url-${index}`}
                  name={`friend-url-${index}`}
                  value={link.url}
                  onChange={(e) => updateItem(index, "url", e.target.value)}
                  placeholder="https://example.com"
                  className="h-10 sm:h-8"
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor={`friend-icon-${index}`} className="text-xs font-medium text-muted-foreground">Logo/图标</Label>
                  {link.url && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleFetchIcon(index, link.url)}
                      disabled={fetchingIconIndex === index}
                      className="h-8 shrink-0 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground sm:h-6 sm:px-1.5"
                      title="从网站地址自动探测图标（自动挑选可用的图标源）"
                    >
                      {fetchingIconIndex === index ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Wand2 className="h-3 w-3" />
                      )}
                      {fetchingIconIndex === index ? "获取中…" : "从网站获取"}
                    </Button>
                  )}
                </div>
                <MediaPicker
                  id={`friend-icon-${index}`}
                  value={link.icon}
                  onChange={(v) => updateItem(index, "icon", v)}
                  placeholder="图标名 / 图片URL / random:关键词"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`friend-description-${index}`} className="text-xs font-medium text-muted-foreground">网站描述</Label>
                <Textarea
                  id={`friend-description-${index}`}
                  name={`friend-description-${index}`}
                  value={link.description}
                  onChange={(e) => updateItem(index, "description", e.target.value)}
                  placeholder="一句话介绍这个网站（可选）"
                  className="min-h-[80px] resize-none sm:min-h-[60px]"
                />
              </div>
            </div>
          </div>
        ))}
        <Button
          onClick={save}
          disabled={saving}
          aria-label="保存友情链接"
          className={`w-full gap-1.5 ${dirty ? "ring-2 ring-primary/40" : ""}`}
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              保存中...
            </>
          ) : dirty ? (
            "● 友情链接有未保存的更改"
          ) : (
            "保存友情链接"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
