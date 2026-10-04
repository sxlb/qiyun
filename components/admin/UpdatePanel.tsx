"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  RefreshCw,
  Rocket,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Loader2,
  GitCompareArrows,
  History,
  HardDrive,
  ExternalLink,
  DownloadCloud,
  AlertTriangle,
  FileClock,
  Sparkles,
  Activity,
  Plus,
  Trash2,
  Star,
  Tag,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PanelHeader, EmptyState, SectionBlock } from "./panel";

interface UpdateRecord {
  id: number;
  version: string;
  action: "update" | "rollback";
  method: "build" | "image";
  fromVersion: string;
  status: "pending" | "running" | "success" | "failed";
  message: string;
  description: string;
  triggeredBy: string;
  estimatedSeconds: number;
  durationSeconds: number | null;
  createdAt: string;
  finishedAt: string | null;
}

/** 更新方式：现仅支持拉取发布镜像；"build" 为旧版本遗留值，仅用于历史记录展示 */
type UpdateMethod = "build" | "image";

interface ResultLike {
  id: string;
  action: "update" | "rollback";
  method?: UpdateMethod;
  version: string;
  status: "running" | "success" | "failed";
  message: string;
  at: string;
}

interface ExecState {
  kind: "pending" | "running" | "idle";
  request?: {
    id: string;
    action: string;
    method?: UpdateMethod;
    version: string;
    estimatedSeconds?: number;
    requestedBy: string;
    createdAt: string;
  };
  running?: ResultLike;
  lastResult?: ResultLike | null;
}

interface BackupSnapshot {
  version: string;
  file: string;
  at: number;
}

interface UpdateStatusData {
  currentVersion: string;
  repo: string;
  latestRelease: {
    tag: string;
    version: string;
    name: string;
    body: string;
    htmlUrl: string;
    publishedAt: string;
  } | null;
  latestError?: string;
  isUpdateAvailable: boolean;
  hostReady: boolean;
  exec: ExecState;
  versions: { currentVersion: string; updatedAt: string; history: { version: string; action: string; at: string }[] } | null;
  rollbackTargets: string[];
  backups: BackupSnapshot[];
  records: UpdateRecord[];
}

/** 发布列表条目相对当前版本的位置：决定该给「更新」还是「回滚」按钮 */
type ReleaseRelation = "newer" | "current" | "older";

/** /api/update/releases 返回的条目（ReleaseInfo + relation） */
interface ReleaseListItem {
  tag: string;
  version: string;
  name: string;
  body: string;
  htmlUrl: string;
  publishedAt: string;
  relation: ReleaseRelation;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}
function formatTs(ts: number): string {
  return new Date(ts).toLocaleString("zh-CN", { hour12: false });
}
function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || seconds <= 0) return "未完成";
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分钟`;
}

const STATUS_MAP: Record<UpdateRecord["status"], { label: string; className: string }> = {
  pending: { label: "排队中", className: "bg-warning/15 text-warning" },
  running: { label: "执行中", className: "bg-info/15 text-info" },
  success: { label: "成功", className: "bg-success/15 text-success" },
  failed: { label: "失败", className: "bg-error/15 text-error" },
};

const ACTION_MAP: Record<UpdateRecord["action"], { label: string; icon: typeof Rocket }> = {
  update: { label: "更新", icon: Rocket },
  rollback: { label: "回滚", icon: RotateCcw },
};

/** 更新方式标签：现仅支持拉取发布镜像；build 为旧版本遗留值，保留以免历史记录取不到标签 */
const METHOD_LABEL: Record<UpdateMethod, string> = {
  image: "拉取镜像",
  build: "自建构建（已停用）",
};

/* ---------------- GitHub 加速代理 ---------------- */

type ProxyScope = "official" | "builtin" | "env" | "custom";

interface ProxySourceItem {
  base: string;
  scope: ProxyScope;
  /** 是否为后台指定的优先代理 */
  preferred?: boolean;
}

interface ProxyTestItem {
  base: string;
  scope: ProxyScope;
  label: string;
  ok: boolean;
  ms: number;
  status?: number;
  reason: string;
}

interface ProxyData {
  sources: ProxySourceItem[];
  custom: string[];
  /** 后台指定的优先代理（null = 全源自动竞速） */
  preferred: string | null;
  results: ProxyTestItem[] | null;
}

const SCOPE_MAP: Record<ProxyScope, { label: string; className: string }> = {
  official: { label: "官方", className: "bg-primary/15 text-primary" },
  builtin: { label: "内置", className: "bg-muted text-muted-foreground" },
  env: { label: "环境变量", className: "bg-info/15 text-info" },
  custom: { label: "自定义", className: "bg-success/15 text-success" },
};

/** 取代理域名用于展示（不引 lib/version：它是服务端模块，会把 fs 带进客户端包） */
function mirrorHost(base: string): string {
  try {
    return new URL(base).host;
  } catch {
    return base;
  }
}

/** 更新/回滚徽章 */
function ActionBadge({ action }: { action: UpdateRecord["action"] }) {
  const { label, icon: Icon } = ACTION_MAP[action];
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

function StatusBadge({ status }: { status: UpdateRecord["status"] }) {
  const { label, className } = STATUS_MAP[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${className}`}>
      {status === "running" ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
      {label}
    </span>
  );
}

/** 更新方式徽章（历史记录用） */
function MethodBadge({ method }: { method: UpdateMethod }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs ${
        method === "image" ? "text-info" : "text-foreground"
      }`}
    >
      {METHOD_LABEL[method]}
    </span>
  );
}

/**
 * 系统更新面板：
 * - 检测 GitHub 最新发布，展示当前版本 / 可更新版本 / 更新日志
 * - 手动触发更新（写入手柄请求，由宿主机定时器执行）
 * - 查看并触发回滚（选择历史版本），展示数据库快照与更新历史
 */
export default function UpdatePanel() {
  const [data, setData] = useState<UpdateStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);
  // GitHub 加速代理：清单（不发网络请求）+ 主动触发的连通性测试结果 + 自定义输入
  const [proxies, setProxies] = useState<ProxyData | null>(null);
  const [testingProxies, setTestingProxies] = useState(false);
  const [savingProxies, setSavingProxies] = useState(false);
  const [newMirror, setNewMirror] = useState("");
  // 版本列表：懒加载（展开区块时才拉）。null = 尚未加载；拉取失败保持 null，下次展开可自动重试
  const [releases, setReleases] = useState<ReleaseListItem[] | null>(null);
  const [releasesError, setReleasesError] = useState<string | null>(null);
  const [loadingReleases, setLoadingReleases] = useState(false);
  const seqRef = useRef(0);
  const mountedRef = useRef(true);

  const busy = data?.exec.kind === "pending" || data?.exec.kind === "running";

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async (force = false) => {
    const seq = ++seqRef.current;
    if (force) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await fetch(`/api/update/status${force ? "?force=1" : ""}`, { cache: "no-store" });
      if (!mountedRef.current || seq !== seqRef.current) return;
      if (res.ok) setData(await res.json());
      else toast.error("获取更新状态失败，请稍后重试");
    } catch {
      if (mountedRef.current && seq === seqRef.current) toast.error("网络错误，获取更新状态失败");
    } finally {
      if (mountedRef.current && seq === seqRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  // 有任务进行中时定时轮询，驱动进度与完成态刷新
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => load(false), 5000);
    return () => clearInterval(timer);
  }, [busy, load]);

  /** 拉取加速代理清单；test=true 时并发测试各源连通性（由「测试连通性」按钮主动触发） */
  const loadProxies = useCallback(async (test = false) => {
    if (test) setTestingProxies(true);
    try {
      const res = await fetch(`/api/update/proxies${test ? "?test=1" : ""}`, { cache: "no-store" });
      if (!mountedRef.current) return;
      if (res.ok) setProxies(await res.json());
      else if (test) toast.error("测试失败，请稍后重试");
    } catch {
      if (mountedRef.current && test) toast.error("网络错误，测试失败");
    } finally {
      if (mountedRef.current) setTestingProxies(false);
    }
  }, []);

  // 面板打开时只取清单（不打网络），避免每次进后台都去探测一圈
  useEffect(() => {
    loadProxies(false);
  }, [loadProxies]);

  /** 拉取发布列表（含各版本更新说明）。30 条自带正文，因此不随面板打开就拉，展开区块时才拉 */
  const loadReleases = useCallback(async (force = false) => {
    setLoadingReleases(true);
    try {
      const res = await fetch(`/api/update/releases${force ? "?force=1" : ""}`, { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as {
        releases?: ReleaseListItem[];
        error?: string | null;
      };
      if (!mountedRef.current) return;
      if (!res.ok) {
        toast.error((body as { error?: string }).error || "获取版本列表失败");
        return;
      }
      setReleases(body.releases ?? []);
      // 服务端能返回列表但拉取来源全失败时带 error：要在区块里如实显示，而不是装作「没有版本」
      setReleasesError(body.error ?? null);
    } catch {
      if (mountedRef.current) toast.error("网络错误，获取版本列表失败");
    } finally {
      if (mountedRef.current) setLoadingReleases(false);
    }
  }, []);

  /** 区块展开时才拉一次（toggle 在部分浏览器挂载时也会触发，这里只认 open=true） */
  const onReleasesToggle = useCallback(
    (open: boolean) => {
      if (open && releases === null && !loadingReleases) void loadReleases(false);
    },
    [releases, loadingReleases, loadReleases]
  );

  /** 保存自定义代理整组列表（添加/删除都走这里），保存后立即重新测试一次 */
  async function saveMirrors(next: string[]) {
    setSavingProxies(true);
    try {
      const res = await fetch("/api/update/proxies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mirrors: next }),
      });
      const body = (await res.json().catch(() => ({}))) as { custom?: string[]; invalid?: number };
      if (!res.ok) {
        toast.error((body as { error?: string }).error || "保存失败");
        return;
      }
      toast.success("代理已保存");
      if (body.invalid) toast.warning(`已忽略 ${body.invalid} 个非法地址（需以 http:// 或 https:// 开头）`);
      setNewMirror("");
      await loadProxies(true);
    } catch {
      toast.error("网络错误，保存失败");
    } finally {
      if (mountedRef.current) setSavingProxies(false);
    }
  }

  /** 指定/清除优先代理：设置后版本检测先单独探它，成功即用，失败自动回退全源竞速 */
  async function setPreferred(base: string | null) {
    setSavingProxies(true);
    try {
      const res = await fetch("/api/update/proxies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferred: base }),
      });
      const body = (await res.json().catch(() => ({}))) as { preferred?: string | null; error?: string };
      if (!res.ok) {
        toast.error(body.error || "设置失败");
        return;
      }
      toast.success(body.preferred ? "已设为优先代理，版本检测将优先走它" : "已恢复自动竞速（全源取最快）");
      await loadProxies(false);
    } catch {
      toast.error("网络错误，设置失败");
    } finally {
      if (mountedRef.current) setSavingProxies(false);
    }
  }

  async function trigger(action: "update" | "rollback", version?: string, description?: string) {
    const key = `${action}:${version || "latest"}`;
    setSubmitting(key);
    try {
      const res = await fetch("/api/update/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, version, description }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        const info = body as { action?: string; version?: string; versionSource?: string };
        if (info.action === "rollback") {
          toast.success(`已提交回滚到 ${version}`);
        } else if (info.versionSource === "cache") {
          // 实时检测最新版本失败，服务端降级用了缓存版本：如实告知，避免用户以为更新的是最新版
          toast.warning(
            `已提交更新到 ${info.version ?? "缓存版本"}（实时检测最新版失败，使用的是上次缓存结果）`
          );
        } else {
          toast.success("已提交更新，正在执行");
        }
        load(false);
      } else {
        toast.error((body as { error?: string }).error || "操作失败，请重试");
      }
    } catch {
      toast.error("网络错误，操作失败");
    } finally {
      setSubmitting(null);
    }
  }

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">加载中...</div>
    );
  }

  const latest = data?.latestRelease;
  const estimatedSeconds = 90;
  const hostReady = data?.hostReady;
  const rollDone = data?.versions?.history?.length;
  // 有数据库快照的版本：回滚时会连数据一起回到该版本；没有快照的只能切代码
  const snapshotVersions = new Set((data?.backups ?? []).map((b) => b.version));

  return (
    <Card className="overflow-hidden border-border shadow-sm">
      <CardContent className="space-y-6 p-5">
        <PanelHeader
          title="系统更新"
          description={
            hostReady
              ? undefined
              : "宿主机更新通道尚未就绪（未安装脚本），请先在服务器部署 update-watch.sh"
          }
          actions={
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => load(true)}
                disabled={refreshing || busy}
                className="gap-1.5"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                检查更新
              </Button>
            </>
          }
        />

        {/* 状态总览 */}
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-border bg-muted/30 p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">当前版本</p>
            <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight">
              {data ? `v${data.currentVersion}` : <span className="text-base font-normal text-muted-foreground">加载中…</span>}
            </p>
            {data?.versions?.updatedAt ? (
              <p className="mt-1 text-xs text-muted-foreground">
                上次变更 {formatTime(data.versions.updatedAt)}
              </p>
            ) : null}
          </div>

          <div className="rounded-xl border border-border bg-muted/30 p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">最新版本</p>
            {latest ? (
              <>
                <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight">
                  {latest.version}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {latest.publishedAt ? formatTime(latest.publishedAt) : ""}
                </p>
              </>
            ) : (
              <p className="mt-1.5 text-sm text-muted-foreground">{data?.latestError || "未获取到"}</p>
            )}
          </div>

          <div className="rounded-xl border border-border bg-muted/30 p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">版本状态</p>
            {data?.isUpdateAvailable ? (
              <>
                <p className="mt-1.5 flex items-center gap-1.5 text-2xl font-semibold text-primary">
                  <Sparkles className="h-5 w-5" /> 有新版本
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  可升级到 v{latest?.version}
                </p>
              </>
            ) : latest ? (
              <p className="mt-1.5 text-lg font-semibold text-success">已是最新</p>
            ) : (
              <p className="mt-1.5 text-sm font-medium text-muted-foreground">
                {data?.latestError || "未知"}
                {data?.latestError ? "，可点击右上角重新检查" : ""}
              </p>
            )}
          </div>
        </div>

        {/* 更新动作 */}
        <SectionBlock
          title="更新到最新版本"
          subtitle={data?.isUpdateAvailable ? `发现 v${latest?.version}` : "暂无新版"}
          dotClass="bg-primary"
          open={Boolean(data?.isUpdateAvailable)}
        >
          {data?.isUpdateAvailable && latest ? (
            <div className="space-y-4">
              <p className="text-sm leading-relaxed text-muted-foreground">
                点击下方按钮将站点更新到最新版本 <strong className="text-foreground">v{latest.version}</strong>，更新前会自动备份当前数据库，失败时可随时回滚。
              </p>
              {latest.body ? (
                <div className="max-h-40 space-y-2 overflow-y-auto rounded-lg border border-border bg-muted/30 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    更新日志
                  </p>
                  <div className="prose prose-sm max-w-none text-sm leading-relaxed text-foreground">
                    <pre className="whitespace-pre-wrap font-sans text-sm">{latest.body}</pre>
                  </div>
                </div>
              ) : null}

              <p className="text-xs text-muted-foreground">
                更新方式：从镜像仓库拉取已发布的镜像并重启，无需在服务器上构建。
              </p>

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  onClick={() => trigger("update")}
                  disabled={busy || !!submitting}
                  className="gap-2"
                >
                  {submitting === "update:latest" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <DownloadCloud className="h-4 w-4" />
                  )}
                  立即更新到 v{latest.version}
                </Button>
                <span className="text-xs text-muted-foreground">
                  预计耗时约 {formatDuration(estimatedSeconds)}
                </span>
                <a
                  href={latest.htmlUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-primary"
                >
                  <ExternalLink className="h-4 w-4" />
                  GitHub 查看
                </a>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <EmptyState
                icon={<CheckCircle2 className="h-5 w-5" />}
                title="当前已是最新版本"
                hint="点击右上角「检查更新」可重新检测 GitHub 发布"
              />
              {/* 没有新版时也把最新版的说明摆出来：否则「已是最新」这块只剩一句提示，
                  想看「我现在跑的这个版本改了什么」还得另找地方 */}
              {latest?.body ? (
                <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    最新版本 v{latest.version} 的更新日志
                  </p>
                  <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground">
                    {latest.body}
                  </pre>
                </div>
              ) : null}
            </div>
          )}
        </SectionBlock>

        {/* 版本列表与更新日志：可查看每个已发布版本各自改了什么，并直接选定某个版本更新/回滚 */}
        <SectionBlock
          title="版本列表与更新日志"
          subtitle={
            loadingReleases && releases === null
              ? "加载中…"
              : releases
                ? `${releases.length} 个已发布版本`
                : "展开后加载"
          }
          dotClass="bg-primary"
          open={false}
          onToggle={onReleasesToggle}
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                这里的每个版本都可以单独选，不必只更新到最新版。
                <b className="text-foreground">更新</b>只换代码、保留现有数据；
                <b className="text-foreground">回滚</b>会把数据库一并恢复到该版本的快照（该版本没有快照时只切代码，已标出）。
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => loadReleases(true)}
                disabled={loadingReleases}
                className="gap-1.5"
              >
                {loadingReleases ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                刷新版本列表
              </Button>
            </div>

            {loadingReleases && releases === null ? (
              <p className="py-6 text-center text-sm text-muted-foreground">正在获取版本列表…</p>
            ) : releasesError ? (
              <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <div className="space-y-0.5">
                  <p className="font-medium text-foreground">获取版本列表失败</p>
                  <p className="text-xs text-muted-foreground">{releasesError}</p>
                  <p className="text-xs text-muted-foreground">
                    可在下方「GitHub 加速代理」里测试连通性并指定一个可用源后重试。
                  </p>
                </div>
              </div>
            ) : !releases?.length ? (
              <EmptyState
                icon={<Tag className="h-5 w-5" />}
                title="没有可用的版本列表"
                hint="GitHub 上还没有发布版本，或列表获取失败"
              />
            ) : (
              <div className="space-y-2">
                {releases.map((r) => {
                  const isCurrent = r.relation === "current";
                  const isNewer = r.relation === "newer";
                  // 更新的和当前的走 update（不动数据）；更旧的走 rollback（恢复数据快照）
                  const action: "update" | "rollback" = isNewer || isCurrent ? "update" : "rollback";
                  const hasSnapshot = snapshotVersions.has(r.version);
                  return (
                    <div
                      key={r.version}
                      className={`rounded-lg border px-4 py-3 ${
                        isCurrent ? "border-primary/40 bg-primary/5" : "border-border bg-muted/30"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <Tag className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="font-mono text-sm font-semibold">{r.version}</span>
                          {isCurrent ? (
                            <span className="inline-flex items-center rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
                              当前版本
                            </span>
                          ) : isNewer ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
                              <Sparkles className="h-3 w-3" /> 新版本
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                              历史版本
                            </span>
                          )}
                          {r.publishedAt ? (
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {formatTime(r.publishedAt)}
                            </span>
                          ) : null}
                          {!isNewer && !isCurrent && !hasSnapshot ? (
                            <span
                              className="text-xs text-warning"
                              title="该版本没有数据库快照，回滚只切换代码、不回退数据"
                            >
                              无数据快照
                            </span>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                          <Button
                            variant={isNewer ? "default" : "outline"}
                            size="sm"
                            disabled={busy || !!submitting || isCurrent}
                            onClick={() => trigger(action, r.version)}
                            className="gap-1.5"
                            title={isCurrent ? "当前正在运行这个版本" : undefined}
                          >
                            {submitting === `${action}:${r.version}` ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : isCurrent ? (
                              <CheckCircle2 className="h-4 w-4" />
                            ) : isNewer ? (
                              <DownloadCloud className="h-4 w-4" />
                            ) : (
                              <RotateCcw className="h-4 w-4" />
                            )}
                            {isCurrent ? "当前运行中" : isNewer ? "更新到此版本" : "回滚到此版本"}
                          </Button>
                          {r.htmlUrl ? (
                            <a
                              href={r.htmlUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-primary"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              发布页
                            </a>
                          ) : null}
                        </div>
                      </div>
                      {r.body ? (
                        <details className="mt-2.5">
                          <summary className="cursor-pointer text-xs text-muted-foreground transition-colors hover:text-foreground">
                            更新内容
                          </summary>
                          <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-background/60 p-3 font-sans text-xs leading-relaxed">
                            {r.body}
                          </pre>
                        </details>
                      ) : (
                        <p className="mt-2 text-xs text-muted-foreground">该版本未填写更新说明</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </SectionBlock>

        {/* 执行中进度 */}
        {busy && data?.exec.kind !== "idle" && (
          <div className="flex items-start gap-3 rounded-xl border border-info/30 bg-info/10 p-4 text-sm">
            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-info" />
            <div className="space-y-0.5">
              <p className="font-medium text-foreground">
                {data.exec.kind === "pending" ? "已提交，等待宿主机执行…" : "更新任务正在执行中…"}
              </p>
              {data.exec.request && (
                <p className="text-xs text-muted-foreground">
                  {data.exec.request.action === "rollback" ? "回滚" : "更新"}到{" "}
                  <strong>{data.exec.request.version}</strong>
                  {data.exec.request.method ? `（${METHOD_LABEL[data.exec.request.method]}）` : null}
                  {data.exec.request.estimatedSeconds
                   ? `，预计 ${formatDuration(data.exec.request.estimatedSeconds)}`
                   : ""}
                  ，发起人 {data.exec.request.requestedBy}，
                  提交于 {formatTime(data.exec.request.createdAt)}
                </p>
              )}
            </div>
          </div>
        )}

        {/* 最近一次执行结果 */}
        {data?.exec.lastResult && data.exec.kind === "idle" && (
          <div
            className={`flex items-start gap-3 rounded-xl border p-4 text-sm ${
              data.exec.lastResult.status === "success"
                ? "border-success/30 bg-success/10"
                : data.exec.lastResult.status === "failed"
                ? "border-error/30 bg-error/10"
                : "border-border bg-muted/30"
            }`}
          >
            {data.exec.lastResult.status === "success" ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            ) : data.exec.lastResult.status === "failed" ? (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-error" />
            ) : (
              <FileClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <div className="space-y-0.5">
              <p className="font-medium text-foreground">
                {data.exec.lastResult.action === "rollback"
                  ? `最近一次回滚（目标 ${data.exec.lastResult.version}）`
                  : `最近一次更新（目标 ${data.exec.lastResult.version}）`}
                {data.exec.lastResult.method ? ` · ${METHOD_LABEL[data.exec.lastResult.method]}` : ""}
                ：{data.exec.lastResult.status === "success" ? "成功" : data.exec.lastResult.status === "failed" ? "失败" : "进行中"}
              </p>
              <p className="text-xs text-muted-foreground">{data.exec.lastResult.message}</p>
            </div>
          </div>
        )}

        {/* 回滚 */}
        <SectionBlock
          title="回滚到历史版本"
          subtitle={`可回滚 ${data?.rollbackTargets.length ?? 0} 个版本`}
          dotClass="bg-warning"
          open={false}
        >
          {data?.rollbackTargets.length ? (
            <div className="space-y-4">
              <p className="text-sm leading-relaxed text-muted-foreground">
                选择之前的历史版本（git tag）进行回滚。回滚同样会先备份当前数据库，可再次回滚到其它版本。
              </p>
              <div className="space-y-2">
                {data.rollbackTargets.map((v) => (
                  <div
                    key={v}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3"
                  >
                    <div className="flex items-center gap-2.5">
                      <GitCompareArrows className="h-4 w-4 text-muted-foreground" />
                      <span className="font-mono text-sm font-semibold">{v}</span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || !!submitting}
                      onClick={() => trigger("rollback", v)}
                      className="gap-1.5"
                    >
                      {submitting === `rollback:${v}` ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RotateCcw className="h-4 w-4" />
                      )}
                      回滚到此版本
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <EmptyState
              icon={<History className="h-5 w-5" />}
              title="暂无历史版本可回滚"
              hint={rollDone ? "当前已是最早的已记录版本" : "完成一次更新或升级后，这里会记录可回滚的历史版本"}
            />
          )}
        </SectionBlock>

        {/* GitHub 加速代理 */}
        <SectionBlock
          title="GitHub 加速代理"
          subtitle={
            proxies?.preferred
              ? `${proxies.sources.length} 个源 · 优先：${mirrorHost(proxies.preferred)}`
              : `${proxies?.sources.length ?? 0} 个源 · 自动竞速`
          }
          dotClass="bg-info"
          open={false}
        >
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-muted-foreground">
              版本检测与更新会并发请求下面这些源，取最快可用的一个。官方源在部分网络下会超时，此时自动降级到代理；
              单个代理失效不影响其它源，全部不可用时还会降级使用上一次缓存的版本信息。
              <br />
              先用「测试连通性」看看哪个可用、哪个快，再点某一行的
              <b> 设为优先 </b>
              让版本检测固定走它（成功即用；它挂了会自动回退到全源竞速，不会把自己卡死）。
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={testingProxies}
                onClick={() => loadProxies(true)}
                className="gap-1.5"
              >
                {testingProxies ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
                {testingProxies ? "测试中..." : "测试连通性"}
              </Button>
              {proxies?.preferred && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={savingProxies}
                  onClick={() => setPreferred(null)}
                  className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Star className="h-3.5 w-3.5" />
                  恢复自动竞速
                </Button>
              )}
              <span className="text-xs text-muted-foreground">
                {proxies?.results
                  ? "最近一次测试结果：见每项右侧"
                  : "点击后并发测试各源，最慢的源决定耗时（约数秒）"}
              </span>
            </div>

            <div className="space-y-2">
              {(proxies?.sources ?? []).map((s) => {
                const r = proxies?.results?.find((x) => x.base === s.base);
                const scope = SCOPE_MAP[s.scope];
                return (
                  <div
                    key={s.base}
                    className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-2.5 ${
                      s.preferred ? "border-warning/40 bg-warning/10" : "border-border bg-muted/30"
                    }`}
                  >
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${scope.className}`}
                      >
                        {scope.label}
                      </span>
                      {s.preferred && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning/20 px-2 py-0.5 text-xs font-medium text-warning">
                          <Star className="h-3 w-3" /> 优先
                        </span>
                      )}
                      <span className="truncate font-mono text-xs text-foreground">{s.base}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {r ? (
                        r.ok ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                            <CheckCircle2 className="h-3.5 w-3.5" /> 可用 {r.ms}ms
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1 text-xs font-medium text-error"
                            title={r.status ? `HTTP ${r.status}` : r.reason}
                          >
                            <XCircle className="h-3.5 w-3.5" /> 不可用（
                            {r.status ? `HTTP ${r.status}` : r.reason}）
                          </span>
                        )
                      ) : (
                        <span className="text-xs text-muted-foreground">未测试</span>
                      )}
                      {s.scope !== "official" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={savingProxies}
                          onClick={() => setPreferred(s.preferred ? null : s.base)}
                          className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                          title="版本检测优先走这个源；它不可用时自动回退全源竞速"
                        >
                          <Star className="h-3.5 w-3.5" /> {s.preferred ? "取消优先" : "设为优先"}
                        </Button>
                      )}
                      {s.scope === "custom" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={savingProxies}
                          onClick={() =>
                            saveMirrors((proxies?.custom ?? []).filter((m) => m !== s.base))
                          }
                          className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-error"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> 删除
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
              <Label htmlFor="newMirror" className="text-xs font-medium text-muted-foreground">
                自定义代理
              </Label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="newMirror"
                  value={newMirror}
                  onChange={(e) => setNewMirror(e.target.value)}
                  placeholder="如 https://hk.gh-proxy.com"
                  className="h-10 min-w-0 flex-1 font-mono text-base sm:h-9 sm:text-xs"
                />
                <Button
                  size="sm"
                  disabled={savingProxies || !newMirror.trim()}
                  onClick={() => saveMirrors([...(proxies?.custom ?? []), newMirror.trim()])}
                  className="gap-1.5"
                >
                  {savingProxies ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  添加
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                只填代理前缀即可（会<b>自动补全</b>上游地址 https://api.github.com/）；若是直连 API 镜像，
                请填到以 .../api.github.com/ 结尾。保存后立即对版本检测生效，内置代理始终保留。
              </p>
            </div>
          </div>
        </SectionBlock>

        {/* 回滚数据快照 */}
        <SectionBlock title="数据库快照" subtitle={`${data?.backups.length ?? 0} 份`} dotClass="bg-success" open={false}>
          {data?.backups.length ? (
            <div className="space-y-2">
              {data.backups.slice(0, 10).map((b) => (
                <div
                  key={b.file}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-4 py-2.5"
                >
                  <div className="flex items-center gap-2.5">
                    <HardDrive className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-foreground">{b.file}</span>
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatTs(b.at)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<HardDrive className="h-5 w-5" />}
              title="暂无数据库快照"
              hint="更新 / 回滚前会自动生成一份 prod-*.db 快照用于回档"
            />
          )}
        </SectionBlock>

        {/* 操作记录：谁在什么时候触发了哪次更新 —— 与上面的「版本更新日志」不是一回事 */}
        <SectionBlock
          title="操作记录"
          subtitle={`${data?.records.length ?? 0} 次触发`}
          dotClass="bg-info"
          open={false}
        >
          {data?.records.length ? (
            <div className="-mx-2 overflow-x-auto">
              <table className="w-full min-w-[620px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-2 py-2 font-medium">操作</th>
                    <th className="px-2 py-2 font-medium">方式</th>
                    <th className="px-2 py-2 font-medium">版本</th>
                    <th className="px-2 py-2 font-medium">状态</th>
                    <th className="px-2 py-2 font-medium">操作者</th>
                    <th className="px-2 py-2 font-medium">发起时间</th>
                    <th className="px-2 py-2 font-medium">耗时</th>
                    <th className="px-2 py-2 font-medium">说明</th>
                  </tr>
                </thead>
                <tbody>
                  {data.records.map((r) => (
                    <tr key={r.id} className="border-b border-border/60 align-top">
                      <td className="px-2 py-2.5">
                        <ActionBadge action={r.action} />
                      </td>
                      <td className="px-2 py-2.5">
                        <MethodBadge method={r.method} />
                      </td>
                      <td className="px-2 py-2.5 font-mono font-medium">{r.version}</td>
                      <td className="px-2 py-2.5">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="px-2 py-2.5 text-muted-foreground">{r.triggeredBy}</td>
                      <td className="px-2 py-2.5 text-xs text-muted-foreground tabular-nums">
                        {formatTime(r.createdAt)}
                      </td>
                      <td className="px-2 py-2.5 text-xs text-muted-foreground tabular-nums">
                        {formatDuration(r.durationSeconds)}
                      </td>
                      <td className="max-w-[220px] px-2 py-2.5">
                        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                          {r.description || r.message || "-"}
                        </p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={<FileClock className="h-5 w-5" />}
              title="暂无更新记录"
              hint="完成更新或回滚后，操作记录会显示在这里"
            />
          )}
        </SectionBlock>

        {!hostReady && (
          <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <p className="leading-relaxed text-foreground">
              尚未检测到宿主机更新通道（data/deploy/versions.json 不存在）。
              请先在服务器安装并启动 <code className="rounded bg-muted px-1 font-mono text-xs">update-watch.sh</code>，
              并记录当前部署版本到 <code className="rounded bg-muted px-1 font-mono text-xs">versions.json</code>，即可启用更新 / 回滚功能。
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}