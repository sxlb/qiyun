"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Eye, EyeOff, AlertCircle } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  // 表单内错误提示（区别于右上角 toast）：登录失败/限流时显示在表单顶部，更醒目
  const [formError, setFormError] = useState("");
  // 两步验证：该账号是否开启 2FA（探测后显示验证码输入框）
  const [requires2fa, setRequires2fa] = useState(false);
  const [totpCode, setTotpCode] = useState("");

  // 已登录用户访问登录页由 middleware 服务端重定向到 /admin，
  // 此处不再做客户端自动跳转，避免与中间件判断不一致造成重定向循环。

  // 设置页面标题
  useEffect(() => {
    document.title = "登录 · 个人主页";
  }, []);

  // 提前预取后台路由（RSC 负载 + 页面 chunk）：
  // 后台是懒加载多面板的重页面，等点击登录后才开始下载会有明显停顿感
  useEffect(() => {
    router.prefetch("/admin");
  }, [router]);

  // 用户名变化时探测是否开启 2FA（IP 限流防枚举，探测失败视为未开启）
  // 【High 修复】使用 AbortController 替代 setTimeout+cancelled 标志，网络请求可被真正中止
  useEffect(() => {
    const name = username.trim();
    if (!name) {
      setRequires2fa(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/auth/2fa-status?username=${encodeURIComponent(name)}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        setRequires2fa(!!data.requires2fa);
      } catch {
        /* 探测失败视为未开启 */
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort(); // 立即中止仍在进行的网络请求，避免残留响应覆盖状态
    };
  }, [username]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setFormError("");
    try {
      // 提交前先检查是否被限流锁定
      const limitRes = await fetch("/api/auth/rate-limit");
      if (limitRes.ok) {
        const limitData = await limitRes.json();
        if (limitData.locked) {
          setFormError(`登录失败次数过多，请 ${limitData.remainingMinutes || 1} 分钟后再试`);
          setLoading(false);
          return;
        }
      }

      // 两步验证：需填写 6 位验证码才能提交
      if (requires2fa && !/^\d{6}$/.test(totpCode)) {
        setFormError("请输入 6 位两步验证码");
        setLoading(false);
        return;
      }

      const res = await signIn("credentials", {
        username,
        password,
        ...(requires2fa ? { totpCode } : {}),
        redirect: false,
      });

      if (res?.ok) {
        // 只需 push：后台首屏会话已由服务端下发，无需再 refresh 触发一次重复的 RSC 往返
        router.push("/admin");
      } else {
        // 登录失败：立即清空密码框（防窥屏 + 防暴破脚本残留），并展示错误提示
        setPassword("");
        // 失败后再次检查是否触发了限流
        const afterLimitRes = await fetch("/api/auth/rate-limit");
        if (afterLimitRes.ok) {
          const afterLimitData = await afterLimitRes.json();
          if (afterLimitData.locked) {
            setFormError(`登录失败次数过多，请 ${afterLimitData.remainingMinutes || 1} 分钟后再试`);
            setLoading(false);
            return;
          }
        }
        setFormError("账号或密码错误，请重新输入");
      }
    } catch {
      setFormError("登录失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    // 深色玻璃主题：背景与首页壁纸底色 #1a1a2e 一致，消除深色首页→纯白后台的视觉断层
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#1a1a2e] p-6">
      {/* 背景氛围光晕：左上/右下两团柔和品牌色，提升深色页面层次（纯装饰，不影响交互） */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(600px 400px at 15% 15%, rgba(168,85,247,0.12), transparent 60%), radial-gradient(600px 400px at 85% 85%, rgba(236,72,153,0.10), transparent 60%)",
        }}
      />
      {/* 卡片入场动画：淡入 + 轻微放大（0.3s），tailwindcss-animate 提供 animate-in 系列 */}
      <Card
        className="glass-card animate-in fade-in zoom-in-95 duration-300 relative w-full max-w-sm border-0 shadow-2xl"
        style={{ backgroundColor: "rgba(0, 0, 0, 0.28)", color: "rgba(245, 245, 245, 1)" }}
      >
        <CardHeader>
          <CardTitle className="text-white">登录</CardTitle>
          <CardDescription className="text-white/60">请输入账号和密码</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            {/* 表单内错误提示（登录失败 / 限流锁定） */}
            {formError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md bg-red-500/15 px-3 py-2 text-sm text-red-300"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="username" className="text-white/80">账号</Label>
              <Input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="请输入账号"
                className="input-glass"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-white/80">密码</Label>
              {/* 相对定位容器：内嵌"显示/隐藏密码"切换按钮 */}
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入密码"
                  className="input-glass pr-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-white/50 transition-colors hover:text-white"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {requires2fa && (
              <div className="space-y-2">
                <Label htmlFor="totpCode" className="text-white/80">两步验证码</Label>
                <Input
                  id="totpCode"
                  name="totpCode"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="6 位验证码（Authenticator）"
                  className="input-glass text-center tracking-[0.3em]"
                  required={requires2fa}
                />
              </div>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="btn-brand w-full transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  登录中...
                </>
              ) : (
                "登录"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
