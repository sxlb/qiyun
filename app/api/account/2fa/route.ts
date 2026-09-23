import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { generateSecret, verifyTOTP, buildOtpauthUrl, recordFailedAttempt, getLoginRateLimitKey } from "@/lib/auth";
import { requireSession, error, parseJsonBody, isRateLimited, internalError, writeOperationLog, getClientIp } from "@/lib/server";

export const dynamic = "force-dynamic";

type Action = "setup" | "enable" | "disable";

/** 查询当前账号 2FA 状态（登录后） */
export async function GET() {
  try {
    const session = await requireSession();
    if (!session || !session.user?.name) return error("未授权", 401);
    const user = await prisma.user.findUnique({ where: { username: session.user.name } });
    return new Response(JSON.stringify({ enabled: !!user?.twoFactorEnabled }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return internalError("[GET /api/account/2fa] 查询失败", e);
  }
}

/** 两步验证管理：setup 生成密钥 / enable 确认开启 / disable 关闭 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();
    if (!session || !session.user?.name) {
      return error("未授权", 401);
    }
    const username = session.user.name;

    // 限流：验证码只有 6 位且 ±1 步内仅 3 个有效码，此前该接口**无限流**，
    // 拿到会话后可无限次尝试验证码；这里按「账号 + IP」双维度限流
    // （登录流程与改密均已有限流，此处此前遗漏）。
    const ip = getClientIp(request) || "unknown";
    if (isRateLimited(`2fa:user:${username}`, 10, 60_000) || isRateLimited(`2fa:ip:${ip}`, 20, 60_000)) {
      return error("操作过于频繁，请稍后再试", 429);
    }

    const json = await parseJsonBody<{ action?: Action; code?: string; password?: string }>(request);
    if (json === null || !json.action) {
      return error("缺少 action 参数");
    }

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) return error("账号不存在", 404);

    // 二次验证当前密码：开启/关闭两步验证属于**凭据变更**，仅凭会话不足以执行。
    // 此前 setup + enable 全程无需密码，攻击者一旦拿到会话即可绑定自己的 TOTP 密钥，
    // 既完成持久化又把真实管理员锁在门外 —— 与 reset-default 的威胁模型自相矛盾。
    const password = typeof json.password === "string" ? json.password : "";
    if (!password) return error("请输入当前密码");
    const passwordOk = await bcrypt.compare(password, user.password);
    if (!passwordOk) {
      recordFailedAttempt(getLoginRateLimitKey(request.headers));
      return error("当前密码不正确", 403);
    }

    if (json.action === "setup") {
      // 已开启时不重复生成（避免覆盖现有密钥）
      if (user.twoFactorEnabled) return error("两步验证已开启");
      const secret = generateSecret();
      await prisma.user.update({
        where: { id: user.id },
        data: { twoFactorSecret: secret },
      });
      return new Response(
        JSON.stringify({ ok: true, secret, otpauthUrl: buildOtpauthUrl(secret, username) }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // enable / disable 均需验证当前验证码
    const code = json.code?.trim() || "";
    if (!/^\d{6}$/.test(code)) return error("请输入 6 位验证码");
    if (!verifyTOTP(user.twoFactorSecret, code)) return error("验证码不正确");

    if (json.action === "enable") {
      if (user.twoFactorEnabled) return error("两步验证已开启");
      await prisma.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true } });
      await writeOperationLog({
        module: "account",
        action: "update",
        username,
        summary: "开启两步验证（TOTP）",
        ip: getClientIp(request),
      });
      return new Response(JSON.stringify({ ok: true, enabled: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // disable
    if (!user.twoFactorEnabled) return error("两步验证未开启");
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: false, twoFactorSecret: "" },
    });
    await writeOperationLog({
      module: "account",
      action: "update",
      username,
      summary: "关闭两步验证",
      ip: getClientIp(request),
    });
    return new Response(JSON.stringify({ ok: true, enabled: false }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return internalError("[POST /api/account/2fa] 操作失败", e);
  }
}
