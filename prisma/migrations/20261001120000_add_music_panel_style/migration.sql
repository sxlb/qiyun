-- 音乐面板风格：vinyl 黑胶暖色（默认）/ editorial 纸面印刷 / mono 黑白等宽
-- 旧的玻璃霓虹已下线；历史数据若存有非法值，由前端解析时回落默认，不影响迁移。
ALTER TABLE "Profile" ADD COLUMN "musicPanelStyle" TEXT NOT NULL DEFAULT 'vinyl';
