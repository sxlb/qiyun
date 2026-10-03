-- 前端右键行为：default 原生 / disabled 禁用 / menu 自定义菜单。
-- 带默认值 'default'，等于不改变现状，加列不影响存量数据。
ALTER TABLE "Profile" ADD COLUMN "rightClickMode" TEXT NOT NULL DEFAULT 'default';
