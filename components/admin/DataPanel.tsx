"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Download, Upload, Loader2, FileJson, RotateCcw, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

/** 本地预览用的备份摘要（仅前端展示，不代表服务端取值） */
interface BackupSummary {
  version: number;
  exportedAt?: string;
  /** 核心项（v1 起始终存在） */
  core: { label: string; value: string }[];
  /** 扩展项：covered=false 表示该备份不含此实体，恢复时不会覆盖现状 */
  extras: { label: string; value: string; covered: boolean }[];
}

/** 备份覆盖范围说明（与服务端 lib/backup.ts 保持一致） */
const BACKUP_SCOPE = [
  "站点配置",
  "社交链接",
  "网站链接",
  "友情链接",
  "作品集",
  "技能云",
  "站点公告",
  "媒体库记录",
  "链接点击统计",
];

/** 数据管理面板：备份下载 + 恢复上传（危险操作二次确认） */
export default function DataPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [summary, setSummary] = useState<BackupSummary | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetConfirmed, setResetConfirmed] = useState(false);
  /** 重置必须二次校验当前密码 */
  const [resetPassword, setResetPassword] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePickFile = (f: File | null) => {
    setFile(f);
    setSummary(null);
    setConfirmed(false);
    if (!f) return;
    // 本地解析预览（不发送）：校验 version 并展示摘要
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        // v1 / v2 / v3 均可恢复；扩展实体按"备份里是否存在"决定是否覆盖
        if (![1, 2, 3].includes(data.version)) {
          toast.error("备份版本不支持（仅支持 v1 / v2 / v3）");
          setFile(null);
          return;
        }
        const count = (v: unknown) => (Array.isArray(v) ? v.length : 0);
        /** 扩展项：不在备份中时显示为未覆盖 */
        const extra = (label: string, key: string) =>
          Array.isArray(data[key])
            ? { label, value: `${count(data[key])} 条`, covered: true }
            : { label, value: "—（本备份不含）", covered: false };

        setSummary({
          version: data.version,
          exportedAt: data.exportedAt ? new Date(data.exportedAt).toLocaleString("zh-CN") : "未知",
          core: [
            { label: "站点配置", value: String(data.profile?.nickname || "（空配置）") },
            { label: "社交链接", value: `${count(data.socialLinks)} 条` },
            { label: "网站链接", value: `${count(data.siteLinks)} 条` },
            { label: "友情链接", value: `${count(data.friendLinks)} 条` },
          ],
          extras: [
            extra("作品集", "projects"),
            extra("技能云", "skills"),
            extra("站点公告", "announcements"),
            extra("媒体库记录", "media"),
            extra("链接点击统计", "linkClicks"),
          ],
        });
      } catch {
        toast.error("备份文件解析失败，请确认为导出的 JSON 文件");
        setFile(null);
      }
    };
    reader.readAsText(f);
  };

  const handleRestore = async () => {
    if (!file || !summary || !confirmed) return;
    setRestoring(true);
    try {
      const text = await file.text();
      const res = await fetch("/api/backup/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true, backup: JSON.parse(text) }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("恢复成功，数据已更新");
        setFile(null);
        setSummary(null);
        setConfirmed(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      } else {
        toast.error(data.error || "恢复失败");
      }
    } catch {
      toast.error("网络错误");
    } finally {
      setRestoring(false);
    }
  };

  /** 恢复默认状态：清空全部业务数据并重建种子默认值（需输入当前密码二次确认） */
  const handleResetDefault = async () => {
    if (!resetPassword) {
      toast.error("请输入当前登录密码");
      return;
    }
    setResetting(true);
    try {
      const res = await fetch("/api/reset-default", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true, password: resetPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message || "已恢复为默认状态");
        setShowResetConfirm(false);
        setResetConfirmed(false);
        setResetPassword("");
      } else {
        toast.error(data.error || "恢复默认失败");
      }
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setResetting(false);
    }
  };

  // 本备份未覆盖的扩展实体：恢复时不会被清空，需明确告知用户
  const uncovered = summary?.extras.filter((r) => !r.covered).map((r) => r.label) ?? [];

  return (
    <Card>
      {/* 页面级标题/描述由 admin/page.tsx 提供，卡内不再重复标题 */}
      <CardContent className="space-y-6">
        {/* 备份区 */}
        <div className="rounded-xl border bg-muted/20 p-4">
          <h3 className="mb-1 text-sm font-semibold">一键备份</h3>
          <p className="mb-2 text-xs text-muted-foreground">
            下载业务数据为 JSON 文件，用于迁移部署或定期存档。
          </p>
          <p className="mb-1 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">备份范围：</span>
            {BACKUP_SCOPE.join(" · ")}
          </p>
          <p className="mb-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">不包含：</span>
            账号与密码（避免备份文件携带口令哈希）、操作日志、访问统计、更新记录，以及已上传的图片文件本身（图片位于
            <code className="mx-1 rounded bg-muted px-1 font-mono">data/uploads</code>
            ，迁移时请随目录一并拷贝；媒体库记录已包含在备份内）。
          </p>
          <a
            href="/api/backup"
            download
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Download className="h-4 w-4" />
            下载备份
          </a>
        </div>

        {/* 恢复区 */}
        <div className="rounded-xl border border-destructive/20 p-4">
          <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
            <Upload className="h-4 w-4" />
            恢复备份
          </h3>
          <p className="mb-3 text-xs text-destructive/80">
            危险操作：恢复将覆盖当前站点配置与全部列表数据，且不可撤销。请确认已下载最新备份。
          </p>

          <div className="space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={(e) => handlePickFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary hover:file:bg-primary/20"
            />

            {summary && (
              <div className="rounded-lg border bg-background/60 p-3 text-sm">
                <div className="mb-2 flex items-center gap-1.5 text-success">
                  <FileJson className="h-4 w-4" />
                  <span className="font-medium">备份文件信息</span>
                </div>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  <li>备份时间：{summary.exportedAt}</li>
                  <li>格式版本：v{summary.version}</li>
                  {summary.core.map((r) => (
                    <li key={r.label}>
                      {r.label}：{r.value}
                    </li>
                  ))}
                  {summary.extras.map((r) => (
                    <li key={r.label}>
                      {r.label}：{r.covered ? r.value : <span className="text-warning">{r.value}</span>}
                    </li>
                  ))}
                </ul>
                {uncovered.length > 0 && (
                  <p className="mt-2 rounded-md bg-warning/10 px-2 py-1.5 text-[11px] text-warning">
                    本备份不含 {uncovered.join(" / ")}。恢复时将<strong>保留</strong>这些数据的现状，不会被清空。
                  </p>
                )}
              </div>
            )}

            {file && (
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-destructive"
                />
                <span className="text-muted-foreground">我了解此操作将覆盖当前数据</span>
              </label>
            )}

            <Button
              variant="destructive"
              onClick={handleRestore}
              disabled={!file || !summary || !confirmed || restoring}
              className="gap-1.5"
            >
              {restoring ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  恢复中...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  确认恢复
                </>
              )}
            </Button>
          </div>
        </div>
      </CardContent>

      {/* 恢复默认状态区 */}
      <CardContent className="border-t space-y-6 pt-6">
        <div className="rounded-xl border border-warning/30 bg-warning/5 p-4">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-warning">
            <AlertTriangle className="h-4 w-4" />
            恢复默认状态
          </h3>
          <p className="mb-3 text-xs text-muted-foreground leading-relaxed">
            清空全部站点配置、链接、作品、技能、公告、媒体库记录、统计数据与日志，并删除已上传的图片文件，随后重建种子默认数据。管理员账号保留，但密码会被重置为
            <code className="mx-1 rounded bg-muted px-1 font-mono text-xs">123456</code>
            并强制下次登录改密。此操作不可撤销，请谨慎执行。
          </p>
          {showResetConfirm ? (
            <div className="space-y-3 rounded-lg border border-warning/40 bg-warning/10 p-3">
              <p className="text-xs font-medium text-warning">你即将重置以下所有数据：</p>
              <ul className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                {[
                  "Profile 站点配置",
                  "社交链接 · 网站链接",
                  "友情链接 · 作品项目",
                  "技能云 · 站点公告",
                  "媒体库记录与图片文件",
                  "操作日志 · 访问统计",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-1">
                    <span className="h-1 w-1 shrink-0 rounded-full bg-warning" />
                    {item}
                  </li>
                ))}
              </ul>

              {/* 二次验证：重置会把密码降级为默认弱口令，必须凭当前密码确认身份 */}
              <div className="space-y-1.5">
                <Label htmlFor="resetPassword" className="text-xs">
                  请输入当前登录密码以确认身份
                </Label>
                <Input
                  id="resetPassword"
                  type="password"
                  autoComplete="current-password"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  placeholder="当前密码"
                />
              </div>

              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={resetConfirmed}
                  onChange={(e) => setResetConfirmed(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-destructive"
                />
                <span className="text-muted-foreground">我已备份数据并确认重置</span>
              </label>

              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleResetDefault}
                  disabled={!resetConfirmed || !resetPassword || resetting}
                  className="gap-1.5"
                >
                  {resetting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      重置中...
                    </>
                  ) : (
                    <>
                      <RotateCcw className="h-4 w-4" />
                      确认恢复默认
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowResetConfirm(false);
                    setResetConfirmed(false);
                    setResetPassword("");
                  }}
                >
                  取消
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-warning/40 text-warning hover:bg-warning/10 hover:text-warning"
              onClick={() => setShowResetConfirm(true)}
            >
              <RotateCcw className="h-4 w-4" />
              恢复默认状态
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
