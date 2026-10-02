-- 系统更新/回档记录表：记录每次更新或回滚的目标版本、执行状态与结果
CREATE TABLE "UpdateRecord" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "version" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromVersion" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "message" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "triggeredBy" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME
);

CREATE INDEX "UpdateRecord_createdAt_idx" ON "UpdateRecord"("createdAt");