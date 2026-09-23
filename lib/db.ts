import { PrismaClient } from "@prisma/client";

// 全局缓存 PrismaClient，避免 Next.js 热重载或多 worker 场景下创建多个连接
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || new PrismaClient();

if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = prisma;
}

// SQLite 写入并发兜底（尽力而为，失败不阻塞启动）：
// - journal_mode=WAL：读写并发不再互相阻塞，显著降低 SQLITE_BUSY（对数据库文件持久生效）
// - busy_timeout=5000：遇到锁竞争时等待最多 5s，而不是立即抛 "database is locked"
// 测试环境跳过：vitest 通常 mock 本模块，且不应触碰真实库文件
if (process.env.NODE_ENV !== "test" && (process.env.DATABASE_URL ?? "").startsWith("file:")) {
    prisma.$queryRawUnsafe("PRAGMA journal_mode = WAL;")
      .catch((e) => console.warn("[db] PRAGMA journal_mode=WAL 配置失败，可能影响写入性能:", e));
    prisma.$executeRawUnsafe("PRAGMA busy_timeout = 5000;")
      .catch((e) => console.warn("[db] PRAGMA busy_timeout=5000 配置失败，可能影响写入性能:", e));
  }
