-- 外部服务地址配置：后台「外部服务」面板可改，上游 API 失效时无需改代码即可换源。
-- 全部默认空串；空值由 lib/external-api.ts 统一回退到内置默认地址，故对存量数据零影响。
ALTER TABLE "Profile" ADD COLUMN "randomImageApi" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Profile" ADD COLUMN "wallpaperLandscapeApi" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Profile" ADD COLUMN "wallpaperAnimeApi" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Profile" ADD COLUMN "randomAvatarApi" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Profile" ADD COLUMN "iconifyApi" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Profile" ADD COLUMN "faviconApi" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Profile" ADD COLUMN "openverseApi" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Profile" ADD COLUMN "bingWallpaperApi" TEXT NOT NULL DEFAULT '';
