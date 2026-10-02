/**
 * 访客 IP 隐私处理（服务端专用模块）。
 *
 * 【VULN-04 修复】访问明细此前直接持久化明文 IP，而 IP 属于《个人信息保护法》规制的
 * 个人信息：数据库文件一旦泄露，全部访客的网络身份可被批量还原。
 *
 * 现改为「写入前完成转换」：
 *   1. 地域在落库时即解析为标签（VisitRecord.region），统计查询不再需要原始 IP；
 *   2. IP 仅保留不可逆哈希（VisitRecord.ipHash）用于独立访客去重。
 */
import { createHmac } from "node:crypto";

/** 哈希截断长度（hex 字符数）：32 位 hex = 128 bit，用于去重足够且存储更短 */
const HASH_HEX_LEN = 32;

/**
 * 生成 IP 的不可逆哈希（HMAC-SHA256，密钥取自 NEXTAUTH_SECRET）。
 *
 * 为什么用 HMAC 而不是裸 SHA-256：IPv4 地址空间仅 2^32，
 * 裸哈希可被穷举反查出原始 IP；加盐后攻击者必须同时掌握服务端密钥才能枚举。
 *
 * @param ip 客户端 IP（允许为空字符串）
 * @returns  32 位 hex 哈希；ip 为空时返回空字符串（调用方据此跳过写入）
 */
export function hashIp(ip: string): string {
  const value = (ip || "").trim();
  if (!value) return "";
  const secret = process.env.NEXTAUTH_SECRET || "";
  return createHmac("sha256", secret).update(value).digest("hex").slice(0, HASH_HEX_LEN);
}
