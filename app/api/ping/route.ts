import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 容器/探活健康检查端点
 * - 公开、无鉴权（供 docker-compose HEALTHCHECK 与运维探活调用，附带 cookie 的请求不需要）
 * - 只读，返回极小体积，不含任何敏感信息，安全暴露
 * - 同时探测数据库连接：DB 不可用时返回 503，让容器健康检查能准确反映关键依赖
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}