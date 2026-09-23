import { withAuth, type NextRequestWithAuth } from "next-auth/middleware";
import { getToken } from "next-auth/jwt";
import { NextResponse, type NextFetchEvent } from "next/server";

const authMiddleware = withAuth({
  pages: { signIn: "/admin/login" },
  callbacks: {
    // 登录页放行（未登录时）；已登录访问登录页由外层 middleware 统一服务端重定向
    authorized({ token, req }) {
      if (req.nextUrl.pathname === "/admin/login") return true;
      return !!token;
    },
  },
});

export default async function middleware(req: NextRequestWithAuth, event: NextFetchEvent) {
  // 已登录用户访问登录页：由服务端直接重定向到后台。
  // 不再依赖登录页客户端 useSession 跳转，避免与中间件 token 判断不一致造成重定向循环。
  if (req.nextUrl.pathname === "/admin/login") {
    const token = await getToken({ req });
    if (token) {
      const url = req.nextUrl.clone();
      url.pathname = "/admin";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }
  return authMiddleware(req, event);
}

export const config = {
  // 【Critical 修复】显式包含 /admin 自身 + 所有子路径，防止认证保护被绕过
  matcher: ["/admin", "/admin/:path*"],
};