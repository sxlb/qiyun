/**
 * IP 解析与校验工具。
 * 独立成模块的原因：lib/server.ts 与 lib/auth.ts 互相引用会形成循环依赖
 * （server.ts 依赖 auth 的 authOptions，auth 又需要 IP 校验），
 * 因此把纯函数抽取到这里供两侧共用。
 */

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
/** IPv6 字符集（真正的结构约束在 isValidIp 内按分组校验） */
const IPV6_CHARS_RE = /^[0-9a-fA-F:]+$/;

/**
 * 校验 IP：IPv4 校验各段值域；IPv6 要求含冒号且分组数合法。
 *
 * 注意：此前 IPv6 分支只做字符集校验，导致 "cafebabe"、"deadbeef" 这类十六进制文本
 * 会被判为合法 IP 并进入 VisitStat.ip 与登录限流键。
 */
export function isValidIp(ip: string): boolean {
  if (!ip || ip.length > 45) return false;
  if (IPV4_RE.test(ip)) return ip.split(".").every((n) => Number(n) <= 255);

  if (!ip.includes(":") || !IPV6_CHARS_RE.test(ip)) return false;
  if (ip.split("::").length > 2) return false; // "::" 压缩只能出现一次
  const groups = ip.split(":");
  return groups.length <= 8 && groups.every((g) => g === "" || /^[0-9a-fA-F]{1,4}$/.test(g));
}

/** 从 x-forwarded-for 提取首个合法 IP（IPv4/IPv6），非法/缺失返回空串 */
export function extractForwardedIp(xff: string | null | undefined): string {
  if (!xff) return "";
  const first = xff.split(",")[0].trim();
  return isValidIp(first) ? first : "";
}

/** 从 x-real-ip 提取合法 IP，非法/缺失返回空串 */
export function extractRealIp(real: string | null | undefined): string {
  if (!real) return "";
  const trimmed = real.trim();
  return isValidIp(trimmed) ? trimmed : "";
}
