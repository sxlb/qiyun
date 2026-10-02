"use client";

/**
 * 统一图标 / 图片选择器（后台用）
 *
 * 交互形态：
 * - **字段行**：预览 + 输入框 + 「选择」按钮（+ 有值时出现的清除按钮）。始终是单行紧凑布局，
 *   在任何列宽（后台两列表单、移动端全宽）下都不会换行或溢出。
 * - **选择弹层**：点击「选择」打开全屏对话层，内部四等分 Tab（URL/路径 · Lucide · Iconify · SVG代码）
 *   与自适应图标网格。选择器不再以「绝对定位浮层」形式挂在字段下方 ——
 *   这是原先不适配的根因：固定 460px 的浮层在窄列/移动端会溢出或被卡片裁切。
 *
 * 支持的值格式：
 *   - lucide 图标："lucide:图标名"（如 "lucide:github"）
 *   - 网络图片：http(s)://... URL；本地图片：/images/xxx.png、/api/uploads/...
 *   - Iconify 图标："prefix:name"（如 "mdi:home"、"fa6-solid:user"）
 *   - 内联 SVG：以 "<svg" 开头的整段代码（阿里 iconfont 直接复制）
 *
 * 注：本组件刻意使用原生 <img> 而非 next/image —— 预览对象是管理员即时输入/第三方搜索返回的
 * 任意外部 URL，走 next/image 需要远程域名白名单且会把不可信图片经优化器代理，故不使用。
 */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Image as ImageIcon,
  Link as LinkIcon,
  Cloud,
  Code2,
  X,
  Pencil,
  Trash2,
  Check,
} from "lucide-react";
import LucideIconPicker from "./LucideIconPicker";
import IconifyPicker from "./IconifyPicker";
import { resolveLucideIcon, LUCIDE_PREFIX, extractLucideIconName } from "@/lib/lucideIconResolver";
import { useIconfontSymbols } from "@/components/Iconfont";
import IconifyIcon from "@/components/IconifyIcon";
import { useExternalApi } from "./useExternalApi";
import {
  isInlineSvgValue,
  isIconifyValue,
  isLocalImagePath,
  renderInlineSvg,
} from "@/lib/iconValue";

interface Props {
  /** 当前值（图标名 / lucide:xxx / prefix:name / http(s) URL） */
  value: string;
  /** 值变更回调 */
  onChange: (value: string) => void;
  /** 占位提示 */
  placeholder?: string;
  /** 标签 */
  label?: string;
  /** 输入框 id（供 <Label htmlFor> 关联，提升可访问性） */
  id?: string;
}

/** 值的来源分类：决定「选择」弹层默认停在哪个 Tab，以及字段行的呈现方式 */
type IconSource = "url" | "lucide" | "iconify" | "svg";

const SOURCES: {
  id: IconSource;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: "url", label: "URL/路径", Icon: LinkIcon },
  { id: "lucide", label: "Lucide", Icon: ImageIcon },
  { id: "iconify", label: "Iconify", Icon: Cloud },
  { id: "svg", label: "SVG代码", Icon: Code2 },
];

/**
 * 是否「看起来是 SVG 代码」：只要求以 <svg 开头。
 *
 * 与 lib/iconValue 的 isInlineSvgValue 刻意分开：后者是**安全校验**（会拒绝带脚本/事件属性
 * 的内容），而这里只用于「该用多行编辑器还是单行输入框」的呈现判断。
 * 若用安全校验来选编辑器，粘贴进来但未通过校验的内容会落进单行输入框（10KB 挤在一行），
 * 连改都没法改。
 */
function looksLikeSvg(value: string): boolean {
  return value.trimStart().startsWith("<svg");
}

/** 由当前值推断来源 */
function resolveSource(value: string): IconSource {
  if (looksLikeSvg(value)) return "svg";
  if (isIconifyValue(value)) return "iconify";
  if (/^https?:\/\//i.test(value) || isLocalImagePath(value)) return "url";
  if (value.startsWith(LUCIDE_PREFIX)) return "lucide";
  return "lucide"; // 含空值与历史裸图标名：默认 Lucide（零依赖，最快加载）
}

/**
 * 预览组件：根据值类型渲染对应图标/图片。
 * Iconify 的地址取自后台「外部服务」配置（空串表示使用内置默认源）。
 */
function MediaPreview({
  value,
  className = "h-10 w-10",
  iconifyApi,
}: {
  value: string;
  className?: string;
  iconifyApi?: string;
}) {
  const iconfontSymbols = useIconfontSymbols();

  if (!value) return null;

  // 内联 SVG 代码（阿里 iconfont 直接复制的一整段 <svg>…</svg>）
  if (isInlineSvgValue(value)) {
    return (
      <span
        className={className}
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}
        // renderInlineSvg 已做安全清洗（去 on* 事件与 href/src）并统一尺寸，避免 200×200 撑破预览框
        dangerouslySetInnerHTML={{ __html: renderInlineSvg(value, 28) }}
      />
    );
  }

  // Iconify 在线图标（prefix:name，如 mdi:home、fa6-solid:user）
  if (isIconifyValue(value)) {
    return (
      <IconifyIcon
        icon={value}
        size={28}
        className={`${className} text-muted-foreground`}
        apiBase={iconifyApi}
      />
    );
  }

  // 图片：网络图片 URL，或本地/媒体路径（/images/xxx.png、/api/uploads/...）
  if (/^https?:\/\//i.test(value) || isLocalImagePath(value)) {
    return (
      <img
        src={value}
        alt=""
        className={`${className} rounded object-cover`}
        onError={(e) => { e.currentTarget.style.display = "none"; }}
      />
    );
  }

  // lucide 图标
  if (value.startsWith(LUCIDE_PREFIX)) {
    const name = extractLucideIconName(value);
    const IconComp = resolveLucideIcon(name);
    if (IconComp) {
      return <IconComp className={`${className} text-muted-foreground`} />;
    }
    return null;
  }

  // iconfont 图标
  if (iconfontSymbols.includes(value)) {
    return (
      <svg className={`${className} text-muted-foreground`} aria-hidden="true" focusable="false">
        <use href={`#${value}`} />
      </svg>
    );
  }

  return null;
}

export default function MediaPicker({
  value,
  onChange,
  placeholder = "输入或选择图标/图片",
  label,
  id,
}: Props) {
  const [open, setOpen] = useState(false);
  /** 弹层内当前 Tab；打开时按当前值自动定位，关闭后保留（下次打开会重新定位） */
  const [tab, setTab] = useState<IconSource>("lucide");
  // 外部服务地址（Iconify）：读取后台「外部服务」配置，未配置时用内置默认
  const externalApi = useExternalApi();
  const iconifyApi = externalApi.iconifyApi || "";

  const source = resolveSource(value);
  const isSvg = source === "svg";

  const openDialog = () => {
    // 每次打开都按「当前值的来源」定位 Tab，避免沿用上次浏览留下的 Tab 造成困惑
    setTab(resolveSource(value));
    setOpen(true);
  };

  // ESC 关闭弹层（与后台其它弹层保持一致的键盘可达性）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="min-w-0 space-y-2">
      {label && <label htmlFor={id} className="text-xs font-medium text-muted-foreground">{label}</label>}

      {/* 字段行：预览 + 单行编辑 + 选择/清除（min-w-0 允许在窄列/移动端收缩，避免撑破父容器） */}
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/30">
          <MediaPreview value={value} iconifyApi={iconifyApi} />
        </div>

        {isSvg ? (
          // SVG 是一整段多行代码，塞进单行输入框既看不清也改不了：
          // 此处只显示状态摘要，点击进入弹层的多行编辑器
          <button
            type="button"
            id={id}
            onClick={openDialog}
            title="点击编辑 SVG 代码"
            className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-muted/20 px-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Code2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate text-xs text-muted-foreground">
              {isInlineSvgValue(value)
                ? `已识别为 SVG 代码（${value.length} 字符），点击编辑`
                : `SVG 代码待完善（${value.length} 字符），点击编辑`}
            </span>
          </button>
        ) : (
          <Input
            id={id}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            spellCheck={false}
            autoComplete="off"
            className="h-10 min-w-0 flex-1"
          />
        )}

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={openDialog}
          className="h-10 shrink-0 gap-1.5"
        >
          <Pencil className="h-3.5 w-3.5" />
          选择
        </Button>

        {value && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange("")}
            title="清除当前值"
            aria-label="清除当前值"
            className="h-10 w-10 shrink-0 p-0 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* ============ 选择弹层 ============ */}
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="选择图标或图片"
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-6"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 头部 */}
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-sm font-medium">选择图标 / 图片</span>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="关闭"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* 来源 Tab：四等分网格，任何视口宽度都不会换行（旧版用 basis 计算 + flex-wrap 会掉行） */}
            <div className="shrink-0 border-b border-border px-3 py-2">
              <div className="grid grid-cols-4 gap-1 rounded-lg bg-muted/50 p-1">
                {SOURCES.map((s) => {
                  const Icon = s.Icon;
                  const active = tab === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setTab(s.id)}
                      aria-pressed={active}
                      className={`flex min-w-0 items-center justify-center gap-1.5 rounded-md px-1 py-2 text-xs transition-colors ${
                        active
                          ? "bg-background font-medium text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{s.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 内容区 */}
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {tab === "url" && (
                <div className="space-y-3">
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    图片地址请填在字段行的输入框中，支持两种写法：
                  </p>
                  <ul className="space-y-1.5 text-xs text-muted-foreground">
                    <li className="flex gap-2">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
                      <span>
                        <span className="font-medium text-foreground">网络图片</span>：以 http(s):// 开头的外链
                      </span>
                    </li>
                    <li className="flex gap-2">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
                      <span>
                        <span className="font-medium text-foreground">本地 / 媒体库</span>：以 / 开头的站内路径，
                        如 /images/icon/github.png、上传后得到的 /api/uploads/...
                      </span>
                    </li>
                  </ul>
                  <p className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                    想用已上传的图片当图标？先到「媒体库」面板上传，再把它对应的 /api/uploads/... 路径填进输入框。
                  </p>
                </div>
              )}

              {tab === "lucide" && (
                <LucideIconPicker
                  value={value.startsWith(LUCIDE_PREFIX) ? value : ""}
                  onChange={(v: string) => onChange(v)}
                />
              )}

              {tab === "iconify" && (
                <div className="space-y-3">
                  {/* 浏览器：切换图标集 + 分类筛选 + 搜索 + 分页（含 FontAwesome / MDI / Tabler 等） */}
                  <IconifyPicker
                    value={isIconifyValue(value) ? value : ""}
                    onChange={(v: string) => onChange(v)}
                  />
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    图标从 iconify.design 在线加载（首次访问需联网），颜色跟随主题文字色。也可直接在字段行输入框填写
                    prefix:name（如 fa6-brands:github、simple-icons:bilibili）。
                  </p>
                </div>
              )}

              {tab === "svg" && (
                <div className="space-y-3">
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    在 iconfont.cn 选中图标 →「复制 SVG」→ 把完整 &lt;svg&gt;…&lt;/svg&gt; 代码粘贴到下面，
                    保存后前台按原色渲染（尺寸会自动缩放，不会撑破布局）。
                  </p>
                  <Textarea
                    value={looksLikeSvg(value) ? value : ""}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={"粘贴 iconfont 导出的完整代码，形如 <svg ...>...</svg>"}
                    spellCheck={false}
                    aria-label="SVG 代码"
                    className="min-h-[180px] w-full font-mono text-xs leading-relaxed"
                  />
                  {isInlineSvgValue(value) && (
                    <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-2.5 py-2">
                      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                        <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                        <span className="truncate">已识别为 SVG 代码（{value.length} 字符）</span>
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onChange("")}
                        className="h-7 shrink-0 px-2 text-xs"
                      >
                        清空
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 底部：当前值摘要 + 完成 */}
            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted/30">
                  <MediaPreview value={value} className="h-6 w-6" iconifyApi={iconifyApi} />
                </div>
                <span className="truncate font-mono text-xs text-muted-foreground" title={value}>
                  {value
                    ? looksLikeSvg(value)
                      ? `SVG 代码（${value.length} 字符）`
                      : value
                    : "尚未选择"}
                </span>
              </div>
              <Button type="button" size="sm" onClick={() => setOpen(false)} className="shrink-0">
                完成
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
