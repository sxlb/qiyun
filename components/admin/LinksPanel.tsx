"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Trash2, Loader2, ChevronUp, ChevronDown, Pencil, Globe, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useListCrud } from "./useListCrud";
import { PanelHeader, EmptyState, PanelLoading } from "./panel";
import MediaPicker from "./MediaPicker";
import { resolveLucideIcon, isLucideIcon, getLucideIconByName } from "@/components/lucideIconResolver";
import { resolveIconImageSrc, isInlineSvgValue, isIconifyValue, renderInlineSvg } from "@/lib/iconValue";
import { resolveFaPresetLucideName } from "@/lib/iconValue";
import IconifyIcon from "@/components/IconifyIcon";

interface LinkItem {
  id?: number;
  /** 前端本地唯一标识（新增行使用，服务端不会持久化），用于列表 key 保持稳定 */
  clientId?: number;
  name: string;
  icon: string;
  url: string;
  tip?: string;
  sort: number;
}

const DEFAULT_URL_PATTERN = /^(https?:\/\/|mailto:|tel:|music:)/;

/** URL 协议逐行校验器 */
function makeUrlValidator(pattern: RegExp) {
  return (link: LinkItem, row: number): string | null => {
    if (!link.url?.trim()) return null;
    if (!pattern.test(link.url.trim())) return `第 ${row} 行：链接格式不合法（请检查协议头）`;
    return null;
  };
}

interface LinksPanelProps {
  /** 链接列表 API 路径（如 /api/social-links、/api/site-links） */
  apiPath: string;
  /** 列表为空时的提示文案 */
  emptyText: string;
  /** 保存成功提示 */
  successMessage: string;
  /** 是否显示"悬停提示"字段（社交链接独有） */
  showTip?: boolean;
  /** 新建行默认图标 */
  defaultIcon?: string;
  /** 名称输入占位 */
  namePlaceholder?: string;
  /** 图标输入占位 */
  iconPlaceholder?: string;
  /** 链接地址输入占位 */
  urlPlaceholder?: string;
  /** Tab 名称（用于保存按钮 aria-label，便于区分社交/网站链接） */
  tabLabel?: string;
}

/** LinkRow 组件 props */
interface LinkRowProps {
  link: LinkItem;
  index: number;
  total: number;
  expanded: boolean;
  showTip: boolean;
  namePlaceholder?: string;
  iconPlaceholder?: string;
  urlPlaceholder?: string;
  onToggle: () => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onUpdate: (field: keyof LinkItem, value: string | number) => void;
}

/**
 * 链接列表面板（社交链接 / 网站链接共用）：
 * - 增/删/改单行 + 批量保存（useLinkList 统一状态管理）
 * - 通过 props 区分两种链接的字段差异（社交链接多一个"悬停提示"）
 */
export default function LinksPanel({
  apiPath,
  emptyText,
  successMessage,
  showTip = false,
  defaultIcon = "globe",
  namePlaceholder = "链接名称",
  iconPlaceholder = "如 github, globe, link",
  urlPlaceholder = "https://example.com",
  tabLabel,
}: LinksPanelProps) {
  const { items: links, loading, saving, dirty, addItem, removeItem, update: updateItem, save } = useListCrud<LinkItem>({
    id: apiPath,
    label: tabLabel ?? "链接",
    api: apiPath,
    makeEmpty: (index) => ({
      name: "",
      icon: defaultIcon,
      url: "",
      ...(showTip ? { tip: "" } : {}),
      sort: index,
    }),
    isSubmittable: (l) => l.name.trim() !== "",
    rowValidators: [
      makeUrlValidator(DEFAULT_URL_PATTERN),
      (link: LinkItem, row: number) => (!link.icon?.trim() ? `第 ${row} 行：图标不能为空` : null),
    ],
    successMessage: () => successMessage,
    loadError: "加载失败",
    saveError: "保存失败",
  });

  // 同一时间只展开一行（-1 表示全部收起）
  const [expandedIndex, setExpandedIndex] = useState(-1);

  const handleAdd = () => {
    addItem();
    setExpandedIndex(links.length);
  };

  const handleRemove = (index: number) => {
    removeItem(index);
    setExpandedIndex((prev) => (prev === index ? -1 : prev > index ? prev - 1 : prev));
  };

  const handleUpdate = (index: number, field: keyof LinkItem, value: string | number) => {
    updateItem(index, field, value);
  };

  // 上移/下移：交换相邻两行的内容字段（id/clientId 跟随行位置，避免主键错乱）
  const handleMove = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= links.length) return;
    const a = links[index];
    const b = links[target];
    const fields: (keyof LinkItem)[] = [
      "name",
      "icon",
      "url",
      "sort",
      ...(showTip ? (["tip"] as (keyof LinkItem)[]) : []),
    ];
    for (const f of fields) {
      updateItem(index, f, b[f]);
      updateItem(target, f, a[f]);
    }
  };

  const handleSave = async () => {
    await save();
    setExpandedIndex(-1);
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
            <Button size="sm" onClick={handleAdd} className="gap-1.5">
              <Plus className="h-4 w-4" />
              添加链接
            </Button>
          }
        />
        {links.length === 0 && (
          <EmptyState icon={<Plus className="h-5 w-5" />} title={emptyText} />
        )}
        {links.map((link, index) => (
          <LinkRow
            key={link.id ?? link.clientId ?? index}
            link={link}
            index={index}
            total={links.length}
            expanded={expandedIndex === index}
            showTip={showTip}
            namePlaceholder={namePlaceholder}
            iconPlaceholder={iconPlaceholder}
            urlPlaceholder={urlPlaceholder}
            onToggle={() => setExpandedIndex(expandedIndex === index ? -1 : index)}
            onMove={(dir) => handleMove(index, dir)}
            onRemove={() => handleRemove(index)}
            onUpdate={(field, value) => handleUpdate(index, field, value)}
          />
        ))}
        <Button
          onClick={handleSave}
          disabled={saving}
          aria-label={`保存${tabLabel ?? "链接"}`}
          className={`w-full gap-1.5 ${dirty ? "ring-2 ring-primary/40" : ""}`}
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              保存中...
            </>
          ) : dirty ? (
            `● ${tabLabel ?? "链接"}有未保存的更改`
          ) : (
            `保存${tabLabel ?? "链接"}`
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * 链接行：收起态为紧凑预览（图标 + 名称/URL + 操作按钮），展开态为完整表单。
 * 收起态是列表默认形态，编辑/排序/删除操作均在此层；展开态聚焦字段编辑。
 */
function LinkRow({
  link,
  index,
  total,
  expanded,
  showTip,
  namePlaceholder = "链接名称",
  iconPlaceholder = "如 github, globe, link",
  urlPlaceholder = "https://example.com",
  onToggle,
  onMove,
  onRemove,
  onUpdate,
}: LinkRowProps) {
  // 「从网站获取」探测中：按钮显示 loading，避免重复点击
  const [fetchingIcon, setFetchingIcon] = useState(false);

  /** 从填写的链接地址自动探测网站图标（服务端依次尝试多个可用图源） */
  const handleFetchIcon = async () => {
    const target = link.url?.trim();
    if (!target) {
      toast.error("请先填写链接地址");
      return;
    }
    setFetchingIcon(true);
    try {
      const res = await fetch(`/api/favicon?url=${encodeURIComponent(target)}`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok && data.url) {
        onUpdate("icon", data.url);
        toast.success(`已获取网站图标（来源：${data.source}）`);
      } else {
        toast.error(data?.error || "未能获取网站图标，请手动填写");
      }
    } catch {
      toast.error("网络错误，获取图标失败");
    } finally {
      setFetchingIcon(false);
    }
  };

  // 收起态：紧凑预览行
  if (!expanded) {
    return (
      <div className="group flex items-center gap-2.5 rounded-xl border bg-card px-3 py-3 transition-all hover:border-primary/30 hover:shadow-sm sm:gap-3 sm:py-2.5">
        {/* 图标缩略图 */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <LinkIconPreview icon={link.icon} />
        </div>
        {/* 名称 + URL */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {link.name.trim() || "未命名链接"}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {link.url || "（未填写链接地址）"}
          </p>
        </div>
        {/* 操作区：排序 / 编辑 / 删除 */}
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            className="rounded-md p-2 sm:p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="上移"
            title="上移"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            className="rounded-md p-2 sm:p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="下移"
            title="下移"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onToggle}
            className="rounded-md p-2 sm:p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="编辑"
            title="编辑"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="rounded-md p-2 sm:p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            aria-label="删除"
            title="删除"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  // 展开态：完整表单（图标选择器仅此处渲染，收起时零渲染）
  return (
    <div className="rounded-xl border bg-card p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <LinkIconPreview icon={link.icon} />
          </div>
          <span className="text-sm font-semibold">编辑链接</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            className="rounded-md p-2 sm:p-1.5 text-muted-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="上移"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            className="rounded-md p-2 sm:p-1.5 text-muted-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="下移"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`link-name-${index}`} className="text-xs font-medium text-muted-foreground">名称</Label>
            <Input
              id={`link-name-${index}`}
              value={link.name}
              onChange={(e) => onUpdate("name", e.target.value)}
              placeholder={namePlaceholder}
              className="h-10 sm:h-8"
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor={`link-icon-${index}`} className="text-xs font-medium text-muted-foreground">图标</Label>
              {link.url && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleFetchIcon()}
                  disabled={fetchingIcon}
                  className="h-8 shrink-0 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground sm:h-6 sm:px-1.5"
                  title="从链接地址自动探测网站图标（自动挑选可用的图标源）"
                >
                  {fetchingIcon ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                  {fetchingIcon ? "获取中…" : "从网站获取"}
                </Button>
              )}
            </div>
            <MediaPicker
              id={`link-icon-${index}`}
              value={link.icon}
              onChange={(v) => onUpdate("icon", v)}
              placeholder={iconPlaceholder}
              iconOnly
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`link-url-${index}`} className="text-xs font-medium text-muted-foreground">链接地址</Label>
          <Input
            id={`link-url-${index}`}
            value={link.url}
            onChange={(e) => onUpdate("url", e.target.value)}
            placeholder={urlPlaceholder}
            className="h-10 sm:h-8"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {showTip && (
            <div className="space-y-1.5">
              <Label htmlFor={`link-tip-${index}`} className="text-xs font-medium text-muted-foreground">悬停提示</Label>
              <Input
                id={`link-tip-${index}`}
                value={link.tip ?? ""}
                onChange={(e) => onUpdate("tip", e.target.value)}
                placeholder="鼠标悬停时显示的文字"
                className="h-10 sm:h-8"
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor={`link-sort-${index}`} className="text-xs font-medium text-muted-foreground">排序</Label>
            <Input
              id={`link-sort-${index}`}
              type="number"
              min={0}
              step={1}
              value={link.sort}
              onChange={(e) => onUpdate("sort", e.target.value === "" ? 0 : Number(e.target.value))}
              className="h-10 sm:h-8"
            />
          </div>
        </div>
      </div>

      {/* 完成：移动端全宽（更好点），≥sm 回到右对齐的小按钮 */}
      <div className="mt-4 flex sm:mt-3 sm:justify-end">
        <Button size="sm" onClick={onToggle} className="h-10 w-full sm:h-9 sm:w-auto">
          完成
        </Button>
      </div>
    </div>
  );
}

/**
 * 链接图标预览：支持内联 SVG 代码 / Iconify（prefix:name）/ lucide:xxx / iconfont /
 * 网络图片 URL 与本地图片路径 / random:关键词 随机图。
 * 供列表收起态与表单内实时预览使用。
 */
export function LinkIconPreview({ icon }: { icon: string }) {
  if (!icon) return <Globe className="h-5 w-5" />;

  // 内联 SVG 代码（iconfont 导出的整段 <svg>…</svg>）
  if (isInlineSvgValue(icon)) {
    return (
      <span
        className="inline-flex h-5 w-5 items-center justify-center"
        dangerouslySetInnerHTML={{ __html: renderInlineSvg(icon, 20) }}
      />
    );
  }

  // Iconify 在线图标
  if (isIconifyValue(icon)) {
    return <IconifyIcon icon={icon} size={20} className="h-5 w-5" />;
  }

  // 图片型：网络图片 URL / 本地图片路径 / random:关键词 随机图
  const imgSrc = resolveIconImageSrc(icon, 40);
  if (imgSrc) {
    return (
      // 管理员提供的任意外部图标地址，走原生 img（详见 MediaPicker 顶部说明）
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imgSrc}
        alt=""
        className="h-5 w-5 rounded object-cover"
        onError={(e) => { e.currentTarget.style.display = "none"; }}
      />
    );
  }

  // @vicons/fa 预设名（历史数据，如 Blog / CompactDisc）
  const presetLucideName = resolveFaPresetLucideName(icon);
  if (presetLucideName) {
    const PresetComp = getLucideIconByName(presetLucideName);
    if (PresetComp) return <PresetComp className="h-5 w-5" />;
  }

  // lucide 图标：支持 "lucide:xxx" 前缀，也兼容历史数据的裸图标名
  const lucideValue = isLucideIcon(icon) ? icon : `lucide:${icon}`;
  const LucideComp = resolveLucideIcon(lucideValue);
  if (LucideComp) return <LucideComp className="h-5 w-5" />;

  // iconfont 图标
  if (icon.startsWith("icon-")) {
    return (
      <svg className="h-5 w-5" aria-hidden>
        <use href={`#${icon}`} />
      </svg>
    );
  }

  return <Globe className="h-5 w-5" />;
}
