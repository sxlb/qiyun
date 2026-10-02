import { PrismaClient } from "@prisma/client";

// 全局缓存 PrismaClient，避免 Next.js 热重载或多 worker 场景下创建多个连接
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || new PrismaClient();

if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = prisma;
}

// ========================================================================
// SQLite 并发写入优化（仅对 file:// 协议生效，测试环境跳过）
// ========================================================================
// 开启 WAL 降低 SQLITE_BUSY，busy_timeout=5000 使锁等待 5s，并开启 foreign_keys 与 journal_size_limit 保障一致性、防止 WAL 无限增长。
// 注意：PRAGMA 在 Prisma 连接复用时只生效一次，多进程部署（如 PM2 cluster）需各 worker 启动后各调用一次。
// ========================================================================
// PRAGMA 不支持参数化绑定，须用 $queryRawUnsafe/$executeRawUnsafe 执行硬编码字符串；
// 会返回结果行的 PRAGMA（journal_mode/busy_timeout/journal_size_limit）必须用 $queryRawUnsafe（$executeRawUnsafe 禁止返回结果，P2010）。
// 【安全约束】这几处 SQL 全为硬编码字面量，严禁拼接任何用户输入或环境变量；如需动态值须改为白名单枚举并补充安全评审。
// ========================================================================
if (process.env.NODE_ENV !== "test" && (process.env.DATABASE_URL ?? "").startsWith("file:")) {
  // WAL 模式 — 持久化设置（即使重启也保持）
  prisma.$queryRawUnsafe("PRAGMA journal_mode = WAL;")
    .catch((e) => console.warn("[db] PRAGMA journal_mode=WAL 配置失败:", e));

  // busy_timeout：锁等待上限（毫秒），非持久化，每次新连接都需设置。
  // 注意：SQLite 的 PRAGMA 设置语句会返回结果行（如 busy_timeout 返回当前值），
  // 而 $executeRawUnsafe 在 SQLite 下禁止返回结果（P2010），必须用 $queryRawUnsafe。
  prisma.$queryRawUnsafe("PRAGMA busy_timeout = 5000;")
    .catch((e) => console.warn("[db] PRAGMA busy_timeout=5000 配置失败:", e));

  // foreign_keys：确保外键约束在执行（SQLite 默认关闭；该 PRAGMA 不返回结果行）
  prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON;")
    .catch((e) => console.warn("[db] PRAGMA foreign_keys=ON 配置失败:", e));

  // journal_size_wal：WAL 文件大小上限（字节），32MB 防止磁盘膨胀（返回设置后的值）
  prisma.$queryRawUnsafe("PRAGMA journal_size_limit = 33554432;")
    .catch((e) => console.warn("[db] PRAGMA journal_size_limit 配置失败:", e));
}
