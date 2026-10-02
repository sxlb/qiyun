-- 壁纸服务端缓存刷新间隔（分钟）：0=不刷新 / 3 / 10 / 30
ALTER TABLE "Profile" ADD COLUMN "wallpaperRefresh" INTEGER NOT NULL DEFAULT 0;
