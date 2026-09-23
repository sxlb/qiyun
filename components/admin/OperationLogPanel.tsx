"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import {
  RefreshCw,
  Loader2,
  ChevronDown,
  Clock,
  User,
  Globe,
  Download,
  Trash2,
} from "lucide-react";
import { PanelHeader, EmptyState } from "./panel";
import { useDataFetcher } from "./useDataFetcher";

interface OperationLog {
  id: number;
  module: string;
  action: string;
  username: string;
  summary: string;
  detail: string;
  ip: string;
  createdAt: string;
}

/** GET /api/operation-logs 的分页响应 */
interface LogPage {
  items: OperationLog[];
  total: number;
  page: number;
}

const MODULE_LABEL: Record<string, string> = {
  profile: "站点信息",
  "social-links": "社交链接",
  "site-links": "网站链接",
  "friend-links": "友情链接",
  account: "账号设置",
  backup: "数据管理",
  announcements: "站点公告",
  logs: "操作日志",
};

/** 模块对应的标签颜色（tailwind 类名） */
const MODULE_COLOR: Record<string, string> = {
  profile: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  "social-links": "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  "site-links": "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400",
  "friend-links": "bg-teal-500/15 text-teal-600 dark:text-teal-400",
  account: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  backup: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
  announcements: "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400",
  logs: "bg-slate-500/15 text-slate-600 dark:text-slate-400",
};

const ACTION_LABEL: Record<string, string> = {
  create: "创建",
  update: "修改",
  delete: "删除",
  batch_update: "批量保存",
  restore: "恢复",
  export: "导出",
  clean: "清理",
};

/** 操作类型对应的语义状态色（P1 设计令牌） */
const ACTION_COLOR: Record<string, string> = {
  create: "text-success",
  update: "text-info",
  delete: "text-error",
  batch_update: "text-warning",
  restore: "text-warning",
  export: "text-info",
  clean: "text-error",
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export default function OperationLogPanel() {
  const [module, setModule] = useState("");
  const [keyword, setKeyword] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  // 导出 / 清理
  const [exporting, setExporting] = useState(false);
  const [showClean, setShowClean] = useState(false);
  const [cleanFrom, setCleanFrom] = useState("");
  const [cleanTo, setCleanTo] = useState("");
  const [cleanAll, setCleanAll] = useState(false);
  const [cleanPending, setCleanPending] = useState(false);
  const [cleaning, setCleaning] = useState(false);

  const PAGE_SIZE = 20;

  const { data, loading, run } = useDataFetcher<LogPage, [number, string, string]>(
    (p, m, k) => {
      const params = new URLSearchParams();
      if (m) params.set("module", m);
      if (k.trim()) params.set("keyword", k.trim());
      params.set("page", String(p));
      params.set("pageSize", String(PAGE_SIZE));
      return fetch(`/api/operation-logs?${params.toString()}`);
    },
    { initialArgs: [1, "", ""], notOkMessage: "加载日志失败", networkMessage: "网络错误" }
  );

  // 列表 / 总数 / 当前页均以服务端返回为准
  const logs = data?.items ?? [];
  const total = data?.total ?? 0;
  const page = data?.page ?? 1;

  // 清理日志后当前页可能越界：服务端原样回显页码，会出现「页码 > 总页数」且列表空白。
  // 条件用 page > lastPage（保证目标页更小），避免接口异常时来回请求。
  useEffect(() => {
    if (!data) return;
    const lastPage = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
    if (data.items.length === 0 && data.page > lastPage) void run(lastPage, module, keyword);
  }, [data, run, module, keyword]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const applyFilter = () => {
    run(1, module, keyword);
  };

  /** 按当前筛选条件导出 CSV */
  async function exportLogs() {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (module) params.set("module", module);
      if (keyword.trim()) params.set("keyword", keyword.trim());
      const res = await fetch(`/api/logs/export?${params.toString()}`);
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        toast.error(d?.error || "导出失败");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `operation-logs-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("日志已导出");
    } catch {
      toast.error("导出失败，请重试");
    } finally {
      setExporting(false);
    }
  }

  /** 第一段确认：记录清理范围，等待用户二次确认 */
  function requestClean() {
    if (!cleanAll && !cleanFrom && !cleanTo) {
      toast.error("请选择清理时间段，或勾选「全部记录」");
      return;
    }
    setCleanPending(true);
  }

  /** 第二段确认：真正执行清理 */
  async function confirmClean() {
    setCleaning(true);
    try {
      const res = await fetch("/api/logs/clean", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: cleanAll ? undefined : cleanFrom || undefined, to: cleanAll ? undefined : cleanTo || undefined }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.summary || "清理成功");
        setShowClean(false);
        setCleanPending(false);
        setCleanFrom("");
        setCleanTo("");
        setCleanAll(false);
        if (cleanAll || (!cleanFrom && !cleanTo)) {
          // 清理了全部或大部分：直接回到第一页
          run(1, module, keyword);
        } else {
          run(page, module, keyword);
        }
      } else {
        toast.error(data.error || "清理失败");
      }
    } catch {
      toast.error("清理失败，请重试");
    } finally {
      setCleaning(false);
    }
  }

  return (
    <Card>
      {/* 页面级标题/描述由 admin/page.tsx 提供，卡内仅保留右侧刷新操作 */}
      <CardContent>
        <div className="mb-3">
          <PanelHeader
            actions={
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={exportLogs}
                  disabled={exporting || loading}
                  className="gap-1.5"
                >
                  {exporting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  导出 CSV
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setShowClean((v) => !v);
                    setCleanPending(false);
                  }}
                  className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                  清理历史
                </Button>
                <Button size="sm" variant="outline" onClick={() => run(page, module, keyword)} disabled={loading} className="gap-1.5">
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  刷新
                </Button>
              </>
            }
          />
        </div>
        {/* 筛选行 */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select
            value={module}
            onChange={(e) => setModule(e.target.value)}
            className="h-10 sm:h-8 rounded-md border border-input bg-background px-2 text-base sm:text-sm"
          >
            <option value="">全部模块</option>
            {Object.entries(MODULE_LABEL).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyFilter()}
            placeholder="搜索操作人或摘要"
            className="h-10 sm:h-8 w-full sm:w-48 rounded-md border border-input bg-background px-3 text-base sm:text-sm"
          />
          <Button size="sm" variant="outline" onClick={applyFilter} className="gap-1.5">
            <RefreshCw className="h-4 w-4" />
            筛选
          </Button>
        </div>

        {/* 清理区：默认收起，二次确认 */}
        {showClean && (
          <div className="mb-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-destructive">
              <Trash2 className="h-4 w-4" />
              清理历史日志
            </h3>
            <p className="mb-4 text-xs text-destructive/80">
              危险操作：按时间段删除操作日志，不可撤销。清理本身会写入一条审计日志。
            </p>

            <div className="mb-3 flex flex-wrap items-center gap-3">
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                起始时间
                <input
                  type="datetime-local"
                  value={cleanFrom}
                  disabled={cleanAll}
                  onChange={(e) => {
                    setCleanFrom(e.target.value);
                    setCleanPending(false);
                  }}
                  className="h-10 sm:h-9 rounded-md border border-input bg-background px-3 text-base sm:text-sm text-foreground disabled:opacity-50"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                结束时间
                <input
                  type="datetime-local"
                  value={cleanTo}
                  disabled={cleanAll}
                  onChange={(e) => {
                    setCleanTo(e.target.value);
                    setCleanPending(false);
                  }}
                  className="h-10 sm:h-9 rounded-md border border-input bg-background px-3 text-base sm:text-sm text-foreground disabled:opacity-50"
                />
              </label>
              <label className="ml-1 mt-5 flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={cleanAll}
                  onChange={(e) => {
                    setCleanAll(e.target.checked);
                    setCleanPending(false);
                  }}
                  className="h-4 w-4 accent-destructive"
                />
                全部记录
              </label>
            </div>

            {cleanPending ? (
              <div className="flex flex-wrap items-center gap-2">
                <p className="mr-2 text-xs font-medium text-destructive">
                  确认清理{cleanAll ? "全部" : ` ${cleanFrom || "起始"} ~ ${cleanTo || "当前"} `}范围内的操作日志？
                </p>
                <Button size="sm" variant="destructive" onClick={confirmClean} disabled={cleaning} className="gap-1.5">
                  {cleaning && <Loader2 className="h-4 w-4 animate-spin" />}
                  确认执行清理
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setCleanPending(false)} disabled={cleaning}>
                  取消
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="destructive" onClick={requestClean} className="gap-1.5">
                <Trash2 className="h-4 w-4" />
                清理
              </Button>
            )}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            加载中...
          </div>
        ) : logs.length === 0 ? (
          <EmptyState icon={<Clock className="h-5 w-5" />} title="暂无操作记录" hint="调整筛选条件或稍后刷新查看" />
        ) : (
          <div className="space-y-1.5">
            {logs.map((log) => {
              const expanded = expandedId === log.id;
              const moduleColor = MODULE_COLOR[log.module] || "bg-muted text-muted-foreground";
              const actionColor = ACTION_COLOR[log.action] || "text-muted-foreground";
              let detailText = "";
              try {
                if (log.detail) {
                  const obj = JSON.parse(log.detail);
                  detailText = JSON.stringify(obj, null, 2);
                }
              } catch {
                detailText = log.detail;
              }

              return (
                <div
                  key={log.id}
                  className="overflow-hidden rounded-xl border transition-all duration-200 hover:border-primary/30"
                >
                  <button
                    onClick={() => setExpandedId(expanded ? null : log.id)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/40"
                  >
                    {/* 模块标签 */}
                    <span className={`shrink-0 rounded-md px-2.5 py-1 text-[11px] font-semibold ${moduleColor}`}>
                      {MODULE_LABEL[log.module] || log.module}
                    </span>
                    {/* 操作类型 */}
                    <span className={`shrink-0 text-xs font-medium ${actionColor}`}>
                      {ACTION_LABEL[log.action] || log.action}
                    </span>
                    {/* 摘要 */}
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground/90">
                      {log.summary}
                    </span>
                    {/* 操作人 - 桌面端显示 */}
                    <span className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground sm:flex">
                      <User className="h-3 w-3" />
                      {log.username}
                    </span>
                    {/* 时间 */}
                    <span className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground md:flex">
                      <Clock className="h-3 w-3" />
                      {formatTime(log.createdAt)}
                    </span>
                    {/* 展开箭头 */}
                    <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}>
                      <ChevronDown className="h-4 w-4" />
                    </div>
                  </button>

                  {/* 展开详情 */}
                  <div
                    className={`grid transition-all duration-300 ease-in-out ${
                      expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                    }`}
                  >
                    <div className="overflow-hidden">
                      <div className="border-t bg-muted/30 px-4 py-3">
                        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            操作人：{log.username}
                          </span>
                          <span className="flex items-center gap-1">
                            <Globe className="h-3 w-3" />
                            IP：{log.ip || "未知"}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            时间：{formatTime(log.createdAt)}
                          </span>
                        </div>
                        {detailText ? (
                          <div className="overflow-hidden rounded-lg border bg-background/60">
                            <div className="border-b bg-muted/50 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                              变更详情
                            </div>
                            <pre className="max-h-64 overflow-auto p-3 text-xs leading-relaxed">
                              {detailText}
                            </pre>
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">无详细变更内容</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 分页栏 */}
        {total > 0 && (
          <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
            <span>共 {total} 条记录</span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1 || loading}
                onClick={() => run(page - 1, module, keyword)}
              >
                上一页
              </Button>
              <span>{page} / {totalPages}</span>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= totalPages || loading}
                onClick={() => run(page + 1, module, keyword)}
              >
                下一页
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}