import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { pickExternalApis, resolveExternalApi } from "@/lib/external-api";

export const dynamic = "force-dynamic";
// 代理必应每日壁纸（规避跨域/国内访问问题）；路由为 force-dynamic，不导出 revalidate，
// 缓存由下方 fetch 的 next.revalidate: 3600 承担；接口地址可在后台「外部服务」面板换源

interface BingResponse {
  images?: Array<{
    url: string;
    copyright?: string;
    title?: string;
  }>;
}

export async function GET() {
  try {
    // 读取外部服务配置（查询失败时回退内置默认地址，不影响壁纸可用性）
    const profile = await prisma.profile.findFirst({ orderBy: { id: "asc" } }).catch(() => null);
    const endpoint = resolveExternalApi(pickExternalApis(profile), "bingWallpaperApi");

    // 【High 修复】强制 10s 超时：/api/wallpaper 读同一上游时已有超时，这里此前漏了，
    // 上游挂起会一直占着这次请求（Next.js event loop），表现为接口长时间不返回
    const res = await fetch(endpoint, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: "壁纸服务不可用" }, { status: 502 });
    }
    const data = (await res.json()) as BingResponse;
    const image = data.images?.[0];
    if (!image?.url) {
      return NextResponse.json({ error: "未获取到壁纸" }, { status: 502 });
    }
    // 以「已配置的接口地址」为基准解析图片直链：上游返回相对路径时可正确补全主机名，
    // 换成镜像或自建代理后也不会再错误地硬拼 bing.com
    return NextResponse.json({
      url: new URL(image.url, endpoint).toString(),
      copyright: image.copyright || "",
      title: image.title || "",
    });
  } catch (e) {
    console.error("[GET /api/bing] error:", e);
    return NextResponse.json({ error: "壁纸服务异常" }, { status: 500 });
  }
}
