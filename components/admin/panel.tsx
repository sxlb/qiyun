import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
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
  children,
}: {
  title: string;
  subtitle: string;
  dotClass: string;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      open={open}
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