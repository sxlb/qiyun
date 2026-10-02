/**
 * SQLite 写入操作重试装饰器（指数退避）。
 *
 * 背景：SQLite 单文件数据库在同一时刻只允许一个写事务。当多个请求并发触发写操作时，
 * 即使已启用 WAL 模式和 busy_timeout，仍可能在极端场景下遇到 "database is locked" 错误。
 * 本模块通过在写操作外围包裹重试逻辑来进一步降低故障率。
 *
 * 设计原则：
 *  - 仅对 SQLite 的锁竞争错误进行重试，其他错误直接抛出（如校验失败、外键约束冲突）
 *  - 使用指数退避策略：重试间隔为 50ms × 2^attempt，避免雪崩式重连
 *  - 最大重试次数 = 3，超时上限约 350ms，不会显著影响用户体验
 *
 * 使用方式：在 API route 中包裹 Prisma 写操作即可。
 * @example
 *   const profile = await withRetry(async (db) => {
 *     return await db.profile.update({ where: { id: 1 }, data });
 *   });
 */

import { prisma } from "./db";

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 50;

/** 判断是否为可重试的 SQLite 锁竞争错误 */
function isSqliteBusy(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as Record<string, unknown>;
  const code = e.code as string | undefined;
  const msg = (e.message as string) || String(e);
  // SQLite 错误码或消息中包含锁竞争信息
  return code === "SQLITE_BUSY" || code === "SQLITE_LOCKED" || msg.includes("database is locked");
}

/**
 * 对单次 Prisma 写操作进行重试包装。
 *
 * @param operation - 接收 PrismaClient 实例并返回 Promise 的函数
 * @returns         写操作结果
 * @throws          超过重试上限后抛出最后一次错误
 */
export async function withRetry<T>(operation: (db: import("@prisma/client").PrismaClient) => Promise<T>): Promise<T> {
  let lastErr: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await operation(prisma);
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES && isSqliteBusy(err)) {
        // 指数退避：50ms -> 100ms -> 200ms
        const delay = RETRY_BASE_MS * Math.pow(2, attempt);
        console.warn(`[db-retry] 写入被锁定，${delay}ms 后重试 (${attempt + 1}/${MAX_RETRIES}): ${String(lastErr)?.slice(0, 120)}`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }

  throw lastErr!;
}
