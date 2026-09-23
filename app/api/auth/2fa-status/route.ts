import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isRateLimited, getClientIp } from "@/lib/server";

export const dynamic = "force-dynamic";

/** 探测账号是否开启 2FA（登录页条件显示验证码输入框）。IP 限流防枚举。 */
export async function GET(request: NextRequest) {
  const username = request.nextUrl.searchParams.get("username")?.trim() || "";
  if (!username) {
    return NextResponse.json({ requires2fa: false });
  }

  const ip = getClientIp(request) || "unknown";
  if (isRateLimited(`2fa-status:${ip}`, 30, 60_000)) {
    return NextResponse.json({ requires2fa: false });
  }

  try {
    const user = await prisma.user.findUnique({ where: { username } });
    return NextResponse.json({ requires2fa: !!user?.twoFactorEnabled });
  } catch {
    return NextResponse.json({ requires2fa: false });
  }
}
