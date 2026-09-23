import { NextResponse, NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { checkRateLimit, recordFailedAttempt, getLoginRateLimitKey } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { writeOperationLog, getClientIp, internalError, error, requireSession, parseJsonBody, formatZodError } from "@/lib/server";
import { isRateLimited } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// 修改账号密码的请求体 schema
const accountSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(2, "用户名至少 2 个字符")
      .max(32, "用户名最长 32 字符")
      .optional(),
    currentPassword: z.string().min(1, "请输入当前密码"),
    newPassword: z
      .string()
      .min(8, "新密码至少 8 个字符")
      .max(128, "新密码最长 128 字符")
      .optional(),
  })
  .refine((data) => data.username || data.newPassword, {
    message: "至少需要修改用户名或密码之一",
    path: ["root"],
  });

export async function PUT(request: NextRequest) {
  try {
    const session = await requireSession();
    if (!session || !session.user?.name) {
      return error("未授权", 401);
    }

    // 【VULN-04】状态变更接口独立限流：每 60s 最多 5 次账号修改（比登录限流更严）
    const accountRateKey = `account-update:${session.user.name}`;
    if (isRateLimited(accountRateKey, 5)) return error("操作过于频繁，请稍后再试", 429);

    const { locked, remainingMs } = checkRateLimit(getLoginRateLimitKey(request.headers));
    if (locked) {
      return error(`操作过于频繁，请 ${Math.ceil(remainingMs / 60000)} 分钟后再试`, 429);
    }

    const json = await parseJsonBody(request);
    if (json === null) {
      return error("请求体格式错误，需为合法 JSON");
    }

    const parsed = accountSchema.safeParse(json);
    if (!parsed.success) {
      return error(`参数校验失败：${formatZodError(parsed.error)}`);
    }

    const { username, currentPassword, newPassword } = parsed.data;

    const user = await prisma.user.findUnique({
      where: { username: session.user.name },
    });
    if (!user) {
      return error("用户不存在", 404);
    }

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) {
      recordFailedAttempt(getLoginRateLimitKey(request.headers));
      return error("当前密码不正确", 403);
    }

    if (username && username !== user.username) {
      const existing = await prisma.user.findUnique({ where: { username } });
      if (existing) {
        return error("该用户名已被占用", 409);
      }
    }

    // 执行更新（仅写入实际变更的字段）
    const updateData: {
      username?: string;
      password?: string;
      mustChangePassword?: boolean;
      // 改密时自增会话版本号：使其它设备上已签发的旧 JWT 立即失效
      sessionVersion?: { increment: number };
    } = {};
    if (username && username !== user.username) updateData.username = username;
    if (newPassword) {
      updateData.password = await bcrypt.hash(newPassword, 10);
      // 已修改密码：清除"强制改密"标记，使后台改密提示消失
      updateData.mustChangePassword = false;
      // 改密后踢出其它设备：旧 token 携带的版本号与库中不一致，随后被判定为已吊销
      updateData.sessionVersion = { increment: 1 };
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ success: true, message: "无变更" });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: updateData,
    });

    // 记录操作日志（失败不影响主操作）。
    // 安全：不记录密码明文/哈希，仅记录变更类型与目标用户名。
    const changedParts: string[] = [];
    if (updateData.username) changedParts.push("用户名");
    if (updateData.password) changedParts.push("密码");
    await writeOperationLog({
      module: "account",
      action: "update",
      username: session.user.name,
      summary: changedParts.length ? `修改了${changedParts.join("、")}` : "无变更",
      detail: JSON.stringify({
        changed: changedParts,
        from: user.username,
        to: updateData.username || user.username,
      }),
      ip: getClientIp(request),
    });

    return NextResponse.json({ success: true, message: "账号信息已更新" });
  } catch (e) {
    return internalError("[PUT /api/account] 保存失败", e);
  }
}
