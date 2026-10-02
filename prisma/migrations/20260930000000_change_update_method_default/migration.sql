-- 更新记录：method 列默认值由 build 改为 image。
-- 更新方式现已固定为「拉取已发布的镜像」，服务器不再本地构建；应用写入时始终显式指定 image，
-- 此默认值仅作兜底。SQLite 不支持直接修改列默认值，故重建表，数据原样保留。
CREATE TABLE "new_UpdateRecord" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "version" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'image',
    "fromVersion" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "message" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "triggeredBy" TEXT NOT NULL DEFAULT '',
    "estimatedSeconds" INTEGER NOT NULL DEFAULT 0,
    "durationSeconds" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME
);

INSERT INTO "new_UpdateRecord" (
    "id", "version", "action", "method", "fromVersion", "status", "message",
    "description", "triggeredBy", "estimatedSeconds", "durationSeconds", "createdAt", "finishedAt"
)
SELECT
    "id", "version", "action", "method", "fromVersion", "status", "message",
    "description", "triggeredBy", "estimatedSeconds", "durationSeconds", "createdAt", "finishedAt"
FROM "UpdateRecord";

DROP TABLE "UpdateRecord";

ALTER TABLE "new_UpdateRecord" RENAME TO "UpdateRecord";

CREATE INDEX "UpdateRecord_createdAt_idx" ON "UpdateRecord"("createdAt");
