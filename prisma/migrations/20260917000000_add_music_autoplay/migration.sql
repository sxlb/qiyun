-- 音乐自动播放开关（后台「音乐设置」面板控制）
ALTER TABLE "Profile" ADD COLUMN "musicAutoplay" BOOLEAN NOT NULL DEFAULT false;
