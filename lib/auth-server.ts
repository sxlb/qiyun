import { getServerSession } from "next-auth";
import { authOptions, validateAuthEnv, isSessionRevoked } from "@/lib/auth";

/**
 * 要求已登录：校验认证环境、获取会话，并确认会话未被吊销。
 * 未登录（或已被吊销）返回 null，调用方应返回 401。
 *
 * 吊销校验的意义：JWT 策略下 token 默认 30 天有效，改密码并不会让它失效。
 * 这里比对 User.sessionVersion，使「改密 / 重置默认」能立即踢掉所有其它设备。
 */
export async function requireSession() {
  validateAuthEnv();
  const session = await getServerSession(authOptions);
  // 严格校验：必须有 user.name（session JWT 缺省字段）。
  // 之前返回 session（真值）会让调用方误判为已授权；空 name 时 isSessionRevoked 也会返回 false，
  // 双重漏洞叠加下，若 JWT Secret 泄露可伪造空 name 的 token 直接进入后台。
  if (!session?.user?.name) return null;
  if (await isSessionRevoked(session)) return null;
  return session;
}
