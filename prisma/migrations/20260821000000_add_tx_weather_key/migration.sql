-- 新增腾讯位置服务 Key（用于"腾讯天气 Key 版"：腾讯位置服务 IP 定位 + 天气实况 API）
ALTER TABLE "Profile" ADD COLUMN "txWeatherKey" TEXT NOT NULL DEFAULT '';
