import { createHash } from "node:crypto";

/**
 * 高德 Web 服务 API 的数字签名（官方规范）。
 *
 * sig = MD5(参数按名升序排序的 "k=v&k=v" 拼接串 + 私钥)
 * - 参与签名的参数包含 key，不含 sig 本身
 * - 值不做 URL 编码（请求时再编码，与官方「＋号正常计算 sig」一致）；私钥直接拼接（无 & 前缀）
 * - MD5 输出小写 hex
 *
 * 抽成独立模块的原因：**凡是要调高德的地方都必须签名**。
 * 健康检查曾经漏了这一步，导致所有开了签名的 Key 都被误判成「Key 无效或权限不足」——
 * 这类"只在探测路径上漏签名"的问题，靠共享同一个函数来根治。
 */
export function amapSign(params: Record<string, string>, secret: string): string {
  const query = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return createHash("md5").update(`${query}${secret}`, "utf8").digest("hex");
}

/** 组装高德请求参数（secret 非空时按规范附带 sig） */
export function buildAmapParams(base: Record<string, string>, secret: string): URLSearchParams {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(base)) sp.set(k, v);
  if (secret) sp.set("sig", amapSign(base, secret));
  return sp;
}

/**
 * 高德接口的业务错误码 → 可照做的提示。
 *
 * 高德的 HTTP 状态恒为 200，成败要看 body 里的 status / infocode，
 * 因此这里把最常见的两类失败翻译成人话，直接用于健康检查的报错文案。
 */
export function describeAmapError(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const data = body as { status?: string; info?: string };
  if (data.status === "1") return null;
  const info = data.info || "";
  if (info.includes("INVALID_USER_SIGNATURE")) {
    return "签名校验未通过：Key 已开启数字签名，请核对「私钥」是否与 Key 成对";
  }
  if (info.includes("INVALID_USER_KEY") || info.includes("SERVICE_NOT_AVAILABLE")) {
    return "Key 无效或权限不足";
  }
  return info || "高德返回了失败状态";
}
