"use client";

import { useEffect, useRef, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, User, Lock, KeyRound } from "lucide-react";

export default function AccountPanel() {
  const { data: session } = useSession();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    username: "",
    currentPassword: "",
    newPassword: "",
  });
  // 登出定时器引用：组件卸载时清理，避免切换面板后仍被强制登出
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 两步验证状态
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [setupData, setSetupData] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [enableCode, setEnableCode] = useState("");
  const [disableCode, setDisableCode] = useState("");
  // 开启/关闭两步验证需二次校验当前密码（服务端强制要求）
  const [pwd2fa, setPwd2fa] = useState("");
  const [saving2fa, setSaving2fa] = useState(false);

  // 初始化读取当前 2FA 状态
  useEffect(() => {
    fetch("/api/account/2fa")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) setTwoFactorEnabled(!!data.enabled); })
      .catch(() => { /* 忽略 */ });
  }, []);

  const call2fa = async (body: Record<string, string>) => {
    setSaving2fa(true);
    try {
      const res = await fetch("/api/account/2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) return data;
      toast.error(data.error || "操作失败");
      return null;
    } catch {
      toast.error("网络错误");
      return null;
    } finally {
      setSaving2fa(false);
    }
  };

  const handleSetup = async () => {
    const data = await call2fa({ action: "setup", password: pwd2fa });
    if (data) setSetupData({ secret: data.secret, otpauthUrl: data.otpauthUrl });
  };

  const handleEnable = async () => {
    const data = await call2fa({ action: "enable", code: enableCode, password: pwd2fa });
    if (data) {
      setTwoFactorEnabled(true);
      setSetupData(null);
      setEnableCode("");
      setPwd2fa("");
      toast.success("两步验证已开启");
    }
  };

  const handleDisable = async () => {
    const data = await call2fa({ action: "disable", code: disableCode, password: pwd2fa });
    if (data) {
      setTwoFactorEnabled(false);
      setDisableCode("");
      setPwd2fa("");
      toast.success("两步验证已关闭");
    }
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // 预填当前用户名：仅在用户尚未输入时填充，避免 session 刷新覆盖正在编辑的内容
  useEffect(() => {
    if (session?.user?.name && !form.username) {
      setForm((prev) => ({ ...prev, username: session.user!.name! }));
    }
  }, [session, form.username]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const username = form.username.trim();
    const usernameChanged = username !== (session?.user?.name ?? "");
    const hasNewPassword = !!form.newPassword;

    // 无任何变更：直接提示并返回，避免触发后端"无变更"响应后的强制登出
    if (!usernameChanged && !hasNewPassword) {
      toast.info("无变更，无需保存");
      return;
    }
    // 用户名变更时至少 2 个字符（与后端 min(2) 一致，提前拦截给出明确提示）
    if (usernameChanged && username.length < 2) {
      toast.error("用户名至少 2 个字符");
      return;
    }

    setSaving(true);
    try {
      // 仅发送实际变更的字段：newPassword 留空时不发送，
      // 否则空串 "" 会被后端 z.string().min(8) 校验拦截，导致"只改用户名"失败
      const body: Record<string, string> = { currentPassword: form.currentPassword };
      if (usernameChanged) body.username = username;
      if (hasNewPassword) body.newPassword = form.newPassword;

      const res = await fetch("/api/account", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("账号信息已更新，请重新登录");
        timerRef.current = setTimeout(() => signOut({ callbackUrl: "/admin/login" }), 1500);
      } else {
        toast.error(data.error || "保存失败");
      }
    } catch {
      toast.error("网络错误");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      {/* 页面级标题/描述由 admin/page.tsx 提供，卡内不再重复标题 */}
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-5">
          {/* 账号信息区域 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                <User className="h-3.5 w-3.5" />
              </div>
              <span className="text-sm font-medium">账号信息</span>
            </div>
            <div className="space-y-2 rounded-xl border bg-muted/20 p-4">
              <div className="space-y-1.5">
                <Label htmlFor="username" className="text-xs font-medium text-muted-foreground">
                  用户名
                </Label>
                <Input
                  id="username"
                  name="username"
                  autoComplete="username"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  placeholder="登录用户名"
                  className="h-10 sm:h-9"
                />
              </div>
            </div>
          </div>

          {/* 密码设置区域 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Lock className="h-3.5 w-3.5" />
              </div>
              <span className="text-sm font-medium">密码设置</span>
            </div>
            <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
              <div className="space-y-1.5">
                <Label htmlFor="currentPassword" className="text-xs font-medium text-muted-foreground">
                  当前密码 <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="currentPassword"
                  name="currentPassword"
                  type="password"
                  autoComplete="current-password"
                  value={form.currentPassword}
                  onChange={(e) =>
                    setForm({ ...form, currentPassword: e.target.value })
                  }
                  placeholder="输入当前密码以验证身份"
                  className="h-10 sm:h-9"
                  required
                />
              </div>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-dashed border-border" />
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-muted/20 px-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                    可选
                  </span>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="newPassword" className="text-xs font-medium text-muted-foreground">
                  新密码
                </Label>
                <div className="relative">
                  <Input
                    id="newPassword"
                    name="newPassword"
                    type="password"
                    autoComplete="new-password"
                    value={form.newPassword}
                    onChange={(e) =>
                      setForm({ ...form, newPassword: e.target.value })
                    }
                    placeholder="输入新密码（至少 8 位）"
                    className="h-10 pr-9 sm:h-9"
                  />
                  <KeyRound className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  留空则不修改密码
                </p>
              </div>
            </div>
          </div>

          <Button type="submit" disabled={saving} className="w-full gap-1.5">
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                保存中...
              </>
            ) : (
              "保存账号信息"
            )}
          </Button>
        </form>

        {/* ===== 两步验证（TOTP）===== */}
        <div className="mt-6 space-y-3 rounded-xl border p-4">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">两步验证（TOTP）</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            使用 Google Authenticator 等应用扫码或手动添加，登录时需额外输入 6 位验证码。
          </p>

          {/* 二次校验：开启/关闭属凭据变更，服务端要求提供当前密码 */}
          <div className="space-y-1.5">
            <Label htmlFor="pwd-2fa" className="text-xs text-muted-foreground">
              当前密码（开启或关闭时需二次校验）
            </Label>
            <Input
              id="pwd-2fa"
              type="password"
              autoComplete="current-password"
              value={pwd2fa}
              onChange={(e) => setPwd2fa(e.target.value)}
              placeholder="输入当前登录密码"
              className="h-10 sm:h-8"
            />
          </div>

          {twoFactorEnabled ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm font-medium text-success">已开启</span>
              <div className="flex items-center gap-2">
                <Input
                  value={disableCode}
                  onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="6 位验证码"
                  maxLength={6}
                  className="h-10 w-28 text-center tracking-widest sm:h-8"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleDisable}
                  disabled={!disableCode || !pwd2fa || saving2fa}
                >
                  关闭
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" onClick={handleSetup} disabled={!pwd2fa || saving2fa}>
              启用两步验证
            </Button>
          )}

          {setupData && !twoFactorEnabled && (
            <div className="rounded-lg border bg-muted/30 p-3 text-xs">
              <p className="mb-2 font-medium">将以下信息添加到验证器应用（或手动输入密钥）：</p>
              <p className="mb-1 break-all text-muted-foreground">
                密钥：<code className="text-foreground">{setupData.secret}</code>
              </p>
              <p className="mb-2 break-all text-muted-foreground">
                OTPAuth：<code className="text-foreground">{setupData.otpauthUrl}</code>
              </p>
              <div className="flex items-center gap-2">
                <Input
                  value={enableCode}
                  onChange={(e) => setEnableCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="输入验证码确认"
                  maxLength={6}
                  className="h-10 w-32 text-center tracking-widest sm:h-8"
                />
                <Button
                  size="sm"
                  onClick={handleEnable}
                  disabled={!/^\d{6}$/.test(enableCode) || !pwd2fa || saving2fa}
                >
                  确认开启
                </Button>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}