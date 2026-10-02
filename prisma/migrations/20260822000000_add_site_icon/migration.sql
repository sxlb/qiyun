-- 新增网站图标（favicon / Logo）URL，用于后台配置后前端动态替换浏览器标签页图标
ALTER TABLE "Profile" ADD COLUMN "siteIcon" TEXT NOT NULL DEFAULT '';
