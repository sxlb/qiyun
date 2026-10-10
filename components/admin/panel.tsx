import type { ReactNode } from "react";
import { Loader2, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

/**
 * 后台面板共享组件：统一 PanelHeader / 空状态 / 加载态 / 折叠分组。
 * 目的：消除各面板间 Header 三套、空状态四种、折叠两套实现的混乱，
 * 让所有面板复用同一套视觉与交互（P0 一致性收敛）。
 */

/** 统一加载态（替换各面板手写的「加载中…」卡片外壳） */
export function PanelLoading({ text = "加载中…" }: { text?: string }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {text}
      </CardContent>
    </Card>
  );
}

/**
 * 面板卡片头部：标题 + 描述 + 右侧操作区（替代各面板手写的 CardHeader/图标式 Header）。
 * 页面级标题/描述由 admin/page.tsx 统一提供，面板内通常只传 actions（避免双标题）；
 * 仅当前面板自身需要补充描述或标题时才传 title/description。
 */
export function PanelHeader({
  title,
  description,
  actions,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
}) {
  const hasText = Boolean(title || description);
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      {hasText && (
        <div className="min-w-0 space-y-1">
          {title && <h3 className="text-base font-semibold tracking-tight text-foreground">{title}</h3>}
          {description && <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>}
        </div>
      )}
      {actions && (
        <div className={`flex shrink-0 items-center gap-2 ${hasText ? "" : "ml-auto"}`}>{actions}</div>
      )}
    </div>
  );
}

/** 统一空状态（替换各面板手写的居中图标 / 虚线框 / 图表内占位等四套写法） */
export function EmptyState({
  icon,
  title,
  hint,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {icon && (
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <span className="flex items-center justify-center text-muted-foreground">{icon}</span>
        </div>
      )}
      <p className="text-sm text-foreground">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** 折叠分组（details）统一样式 */
export function SectionBlock({
  title,
  subtitle,
  dotClass,
  open,
  onToggle,
  children,
}: {
  title: string;
  subtitle: string;
  dotClass: string;
  open?: boolean;
  /**
   * 展开 / 收起回调。用途是「展开时才去拉数据」的懒加载
   * （如系统更新里的版本列表：30 条发布各自带说明正文，开面板就拉太浪费）。
   * 注意 toggle 事件在部分浏览器里也会在挂载时触发一次，调用方需自行判断 open。
   */
  onToggle?: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <details
      open={open}
      onToggle={(e) => onToggle?.(e.currentTarget.open)}
      className="group overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-all"
    >
      <summary className="flex cursor-pointer items-center justify-between px-4 py-3.5 transition-colors hover:bg-muted/40 [&::-webkit-details-marker]:hidden list-none">
        <span className="flex items-center gap-2.5">
          <span className={`h-2 w-2 rounded-full ${dotClass}`} />
          {/* 区块小标题：13-14px/600（P1 排版节奏） */}
          <span className="text-sm font-semibold tracking-tight">{title}</span>
          <span className="text-xs font-normal text-muted-foreground">{subtitle}</span>
        </span>
        <svg
          className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </summary>
      <div className="space-y-5 border-t px-5 py-5">{children}</div>
    </details>
  );
}

/** 小节标题（居中分隔线形式） */
export function SubTitle({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-px flex-1 bg-border/60" />
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {children}
      </h4>
      <div className="h-px flex-1 bg-border/60" />
    </div>
  );
}

/**
 * 列表末尾的「添加」入口。
 *
 * 各面板原本只在右上角放添加入口，条目一多就得先滚回顶部才能接着加 —— 列表越长越别扭，
 * 手机上尤其明显。这里在列表尾部再提供一个能力相同的入口；顶部那个保留，
 * 因为在顶部时没必要先滚到底。
 */
export function AddRowButton({
  label,
  onClick,
  disabled,
}: {
  /** 按钮文案，与顶部入口保持一致（如「添加技能」） */
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-2.5 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:bg-muted/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Plus className="h-4 w-4" aria-hidden />
      {label}
    </button>
  );
}