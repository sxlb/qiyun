-- 补齐此前仅存在于 schema（本地 dev.db 经 db push 应用过）而缺失于迁移历史的字段。
-- 修复：amapSecretKey / txWeatherSk / iconfontUrl 在生产 migrate deploy 后缺列的问题。
ALTER TABLE "Profile" ADD COLUMN "amapSecretKey" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Profile" ADD COLUMN "txWeatherSk" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Profile" ADD COLUMN "iconfontUrl" TEXT NOT NULL DEFAULT '';