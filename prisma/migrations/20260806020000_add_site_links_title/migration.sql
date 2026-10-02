-- AlterTable
-- 网站链接区标题配置：文字 + 图标
ALTER TABLE "Profile" ADD COLUMN "siteLinksTitle" TEXT NOT NULL DEFAULT '网站列表';
ALTER TABLE "Profile" ADD COLUMN "siteLinksIcon" TEXT NOT NULL DEFAULT 'link';
