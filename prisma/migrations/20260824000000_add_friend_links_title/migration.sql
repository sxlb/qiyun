-- AlterTable
-- 友情链接区标题配置（网站/友情合并 tab 后的「友情」可配置标题）
ALTER TABLE "Profile" ADD COLUMN "friendLinksTitle" TEXT NOT NULL DEFAULT '友情链接';