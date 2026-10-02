-- CreateTable
-- 友情链接表：此前仅存在于 schema（本地经 db push 应用），缺失于迁移历史。
-- 本迁移补齐建表，保证全新环境 prisma migrate deploy 后 FriendLink 表存在。
CREATE TABLE "FriendLink" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
