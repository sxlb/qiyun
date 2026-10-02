-- 天气数据源下线迁移：uapis.cn/api/weather 已下线（返回 404），
-- 将历史写入的 "uapis" 统一迁移为可用的 "wttr"（wttr.in）。
-- 路由对 "uapis" 也做了兼容处理（按 wttr 走），此迁移仅用于规范存量数据。
UPDATE "Profile" SET "weatherProvider" = 'wttr' WHERE "weatherProvider" = 'uapis';
