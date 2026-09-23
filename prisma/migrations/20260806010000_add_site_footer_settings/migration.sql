-- AlterTable
-- 页脚增强字段：公安备案号、建站日期（运行天数）
ALTER TABLE "Profile" ADD COLUMN "siteMps" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Profile" ADD COLUMN "siteStart" TEXT NOT NULL DEFAULT '';
