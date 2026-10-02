-- AlterTable
-- 新增壁纸 API 字段（空字符串表示使用默认必应每日壁纸）
ALTER TABLE "Profile" ADD COLUMN "bgApi" TEXT NOT NULL DEFAULT '';
