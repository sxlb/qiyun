-- 修复天气数据源字段（仅数据迁移，不改表结构）
-- 背景：历史版本的路由逻辑把 "wttr" 当作 UAPI 使用（wttr.in 只做失败兜底），
-- 而后台枚举已加入显式的 "uapis"。为保持存量实例行为不变且展示与真实数据源一致，
-- 将历史写入的 "wttr" 统一迁移为 "uapis"；真正想用 wttr.in 的用户可在后台重新选择。
UPDATE "Profile" SET "weatherProvider" = 'uapis' WHERE "weatherProvider" = 'wttr';
