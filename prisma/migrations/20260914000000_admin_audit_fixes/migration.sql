-- 本次后台审计修复涉及的 schema 变更

-- 1) 会话版本号：改密 / 重置默认时自增，使已签发的旧 JWT 立即失效。
--    JWT 策略下 token 默认 30 天有效，缺少该字段就无法实现"改密后踢出其它设备"。
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- 2) 下线幽灵字段 logoFont：
--    该字段历史上允许 19 种艺术字体，但前台只实现了内置的「有爱圆体」一款，
--    后台也不再提供选择控件，存值不会产生任何视觉差异。
ALTER TABLE "Profile" DROP COLUMN "logoFont";

-- 3) 随笔/文章功能已下线（前台路由与后台面板均已移除），删除文章表。
DROP TABLE "Article";
