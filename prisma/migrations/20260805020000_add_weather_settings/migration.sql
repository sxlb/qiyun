-- AlterTable
-- 天气配置字段：数据源（wttr/amap/tencent）、高德 Key、城市
ALTER TABLE "Profile" ADD COLUMN "weatherProvider" TEXT NOT NULL DEFAULT 'wttr';
ALTER TABLE "Profile" ADD COLUMN "amapKey" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Profile" ADD COLUMN "weatherCity" TEXT NOT NULL DEFAULT '';