"use client";

import { useEffect } from "react";
import { SessionProvider } from "next-auth/react";
import { signOut } from "next-auth/react";
import type { Session } from "next-auth";
import { GlobalSaveProvider, GlobalSaveFab } from "./GlobalSave";

/**
 * 后台客户端 Provider 容器（从 layout 拆出，让 layout 保持为服务端组件）。
 *
 * session 由服务端下发：客户端首屏 useSession 立刻是 authenticated，
 * 不必再等一次 /api/auth/session 往返（后台此前会先卡在「加载中...」再渲染）。
 * 路由保护仍由 middleware 负责，这里只解决首屏等待与状态闪烁。
 *
 * revoked：服务端检出会话已被吊销（改密 / 重置默认 / 账号被删）时为 true，
 * 此时不下发 session，并渲染 ForceSignOut 主动清除本地 Cookie。
 */

// ===== 会话吊销兜底（内联自 ForceSignOut.tsx） =====

function ForceSignOut() {
  useEffect(() => {
    void signOut({ callbackUrl: "/admin/login" });
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center px-6 text-center">
      <p className="text-sm text-muted-foreground">登录状态已失效（密码已变更），正在退出…</p>
    </div>
  );
}

export default function AdminProviders({
  session,
  revoked = false,
  children,
}: {
  session: Session | null;
  revoked?: boolean;
  children: React.ReactNode;
}) {
  if (revoked) {
    return <ForceSignOut />;
  }
  return (
    <SessionProvider session={session}>
      <GlobalSaveProvider>
        {children}
        <GlobalSaveFab />
      </GlobalSaveProvider>
    </SessionProvider>
  );
}
