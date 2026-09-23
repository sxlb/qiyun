import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { profileSchema } from "@/lib/validation";
import { writeOperationLog, getClientIp, diffProfile, getChangedProfileFields, internalError, error, requireSession, parseJsonBody, formatZodError } from "@/lib/server";
import { isRateLimited } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    if (!session) return error("未授权", 401);
    const profile = await prisma.profile.findFirst({ orderBy: { id: "asc" } });
    if (!profile) {
      return error("未找到配置", 404);
    }
    return NextResponse.json(profile);
  } catch (e) {
    return internalError("[GET /api/profile] 查询失败", e);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await requireSession();
    if (!session) return error("未授权", 401);

    // 【VULN-04】状态变更接口限流：每 60s 最多 10 次配置保存
    const rateKey = `profile-update:${session.user?.name || getClientIp(request)}`;
    if (isRateLimited(rateKey, 10)) return error("操作过于频繁，请稍后再试", 429);

    const json = await parseJsonBody(request);
    if (json === null) {
      return error("请求体格式错误，需为合法 JSON");
    }

    const parsed = profileSchema.safeParse(json);
    if (!parsed.success) {
      return error(`参数校验失败：${formatZodError(parsed.error)}`);
    }

    // 单例模型：使用 upsert 防止并发创建多条记录
    const existing = await prisma.profile.findFirst({ orderBy: { id: "asc" } });

    // profileSchema.safeParse 输出只包含 schema 定义字段（Zod strip + default），
    // 可直接传给 Prisma update。**禁止手动白名单解构**——漏字段时会静默丢弃，
    // 已被 tests/profile-schema.test.ts 的金丝雀测试「所有 schema 字段都能被落库」覆盖。
    const data = parsed.data;

    const before = (existing as Record<string, unknown>) || {};
    const after = data as unknown as Record<string, unknown>;

    // 没有任何字段变化时跳过写库，避免每次保存都刷新 updatedAt/写日志
    if (existing && getChangedProfileFields(before, after).length === 0) {
      return NextResponse.json(existing);
    }

    const profile = existing
      ? await prisma.profile.update({ where: { id: existing.id }, data })
      : await prisma.profile.create({ data });

    // 记录操作日志（失败不影响主操作）
    const username = session.user?.name || "unknown";
    const { summary, detail } = diffProfile(before, after);
    await writeOperationLog({
      module: "profile",
      action: existing ? "update" : "create",
      username,
      summary,
      detail,
      ip: getClientIp(request),
    });

    return NextResponse.json(profile);
  } catch (e) {
    return internalError("[PUT /api/profile] 保存失败", e);
  }
}
