"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw, CheckCircle2, XCircle, MinusCircle, Loader2, Activity, Zap, AlertTriangle } from "lucide-react";
import { PanelHeader, EmptyState, PanelLoading } from "./panel";
import { useDataFetcher } from "./useDataFetcher";

interface ServiceStatus {
  id: string;
  name: string;
  desc: string;
  url: string;
  status: "ok" | "fail" | "skip";
  latency: number;
  error?: string;
}

interface HealthData {
  checkedAt: number;
  cached: boolean;
  services: ServiceStatus[];
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false });
}

/** 状态徽章：正常绿 / 异常红 / 跳过灰 */
function StatusBadge({ status }: { status: ServiceStatus["status"] }) {
  if (status === "ok") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-semibold text-success">
        <CheckCircle2 className="h-3.5 w-3.5" />
        正常
      </span>
    );
  }
  if (status === "fail") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-error/15 px-2.5 py-0.5 text-xs font-semibold text-error">
        <XCircle className="h-3.5 w-3.5" />
        异常
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
      <MinusCircle className="h-3.5 w-3.5" />
      未启用
    </span>
  );
}

/** 延迟显示：根据延迟值显示不同颜色 */
function LatencyBadge({ latency, status }: { latency: number; status: ServiceStatus["status"] }) {
  if (status !== "ok") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground/70">
        <Zap className="h-3 w-3" />
        -- ms
      </span>
    );
  }
  let colorClass = "text-success";
  if (latency > 500) colorClass = "text-warning";
  if (latency > 1500) colorClass = "text-error";
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium tabular-nums ${colorClass}`}>
      <Zap className="h-3 w-3" />
      {latency} ms
    </span>
  );
}

/**
 * 外部上游服务健康面板：
 * - 展示各上游服务（天气/壁纸/一言/翻译/示例音频等）的实时可用状态与延迟
 * - 结果由 /api/health 探测（30 秒缓存），可手动强制刷新
 */
export default function HealthPanel() {
  const { data, loading, run } = useDataFetcher<HealthData, [boolean]>(
    (force) => fetch(`/api/health${force ? "?force=1" : ""}`, { cache: "no-store" }),
    {
      initialArgs: [false],
      notOkMessage: "检测失败，请稍后重试",
      networkMessage: "网络错误，检测失败",
    }
  );
  // 已有数据时的再次加载：保留内容，只在刷新按钮上转圈
  const refreshing = loading && data !== null;

  if (loading && !data) {
    return <PanelLoading text="检测中..." />;
  }

  const services = data?.services ?? [];
  const okCount = services.filter((s) => s.status === "ok").length;
  const failCount = services.filter((s) => s.status === "fail").length;
  const skipCount = services.filter((s) => s.status === "skip").length;

  return (
    <Card>
      {/* 页面级标题/描述由 admin/page.tsx 提供，卡内仅保留右侧刷新操作 */}
      <CardContent>
        <div className="mb-3">
          <PanelHeader
            actions={
              <Button size="sm" variant="outline" onClick={() => run(true)} disabled={refreshing} className="gap-1.5 shrink-0">
                {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                刷新
              </Button>
            }
          />
        </div>
        {data && (
          <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">
              上次检测：{formatTime(data.checkedAt)}
              {data.cached ? "（30秒缓存）" : ""}
            </span>
            <span className="text-border">·</span>
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-success" />
              <span className="text-success font-medium">正常 {okCount}</span>
            </div>
            <span className="text-border">·</span>
            <div className="flex items-center gap-1.5">
              <span className={`inline-block h-2 w-2 rounded-full ${failCount > 0 ? "bg-error animate-pulse" : "bg-error/40"}`} />
              <span className={failCount > 0 ? "text-error font-medium" : "text-muted-foreground"}>异常 {failCount}</span>
            </div>
            <span className="text-border">·</span>
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/40" />
              <span className="text-muted-foreground">未启用 {skipCount}</span>
            </div>
          </div>
        )}
        {services.length === 0 && (
          <EmptyState icon={<Activity className="h-5 w-5" />} title="暂无探测结果" hint="点击右上角刷新开始检测" />
        )}
        {services.length > 0 && (
          <div className="space-y-2">
          {services.map((s) => {
            const borderColor =
              s.status === "ok"
                ? "border-l-success/50 hover:border-l-success"
                : s.status === "fail"
                ? "border-l-error/50 hover:border-l-error"
                : "border-l-muted-foreground/30 hover:border-l-muted-foreground/50";
            return (
              <div
                key={s.id}
                className={`group relative flex flex-wrap items-center gap-x-3 gap-y-2 overflow-hidden rounded-lg border border-l-4 bg-card px-4 py-3 transition-all hover:shadow-sm ${borderColor}`}
              >
                {/* 状态指示器 - 左侧 */}
                <div className="flex items-center gap-2.5">
                  <StatusBadge status={s.status} />
                </div>

                {/* 服务信息 */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {/* title 兜底：hover 条仅在桌面展开，移动端可长按名称查看完整 URL */}
                    <span className="truncate text-sm font-medium" title={s.url}>{s.name}</span>
                    <LatencyBadge latency={s.latency} status={s.status} />
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{s.desc}</p>
                </div>

                {/* 错误信息 */}
                {s.status === "fail" && s.error && (
                  <div className="flex w-full items-start gap-1.5 text-xs text-error sm:w-auto">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    <span className="truncate">{s.error}</span>
                  </div>
                )}

                {/* URL 提示 - hover 显示 */}
                <div className="absolute bottom-0 right-0 left-0 max-h-0 overflow-hidden bg-muted/50 px-4 text-[10px] text-muted-foreground transition-all duration-200 group-hover:max-h-6 group-hover:py-1">
                  {s.url}
                </div>
              </div>
            );
          })}
        </div>
        )}
      </CardContent>
    </Card>
  );
}
