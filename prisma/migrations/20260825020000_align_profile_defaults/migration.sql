-- 对齐 Profile 表三处列默认值与 schema 定义：
--   weatherProvider: 'wttr' -> 'tencent'
--   siteLinksTitle:  '网站列表' -> '我的网站'
--   logoFont:        'pacifico' -> 'zcool-kuail'
-- SQLite 不支持 ALTER COLUMN SET DEFAULT，采用"新建表 + 迁移数据 + 重建"的标准做法；
-- 顺带将 createdAt/updatedAt 统一为 TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP（与其余表一致）。
-- 注意：Profile 为单行配置表，重建保留已有数据行。
CREATE TABLE "Profile_new" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "avatar" TEXT NOT NULL DEFAULT '',
    "siteIcon" TEXT NOT NULL DEFAULT '',
    "nickname" TEXT NOT NULL DEFAULT '无名',
    "bio" TEXT NOT NULL DEFAULT '这个人很懒，什么都没写',
    "github" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "bgApi" TEXT NOT NULL DEFAULT '',
    "weatherProvider" TEXT NOT NULL DEFAULT 'tencent',
    "amapKey" TEXT NOT NULL DEFAULT '',
    "amapSecretKey" TEXT NOT NULL DEFAULT '',
    "weatherCity" TEXT NOT NULL DEFAULT '',
    "txWeatherKey" TEXT NOT NULL DEFAULT '',
    "txWeatherSk" TEXT NOT NULL DEFAULT '',
    "coverType" TEXT NOT NULL DEFAULT 'bing',
    "autoBGSwitchInterval" INTEGER NOT NULL DEFAULT 0,
    "wallpaperRefresh" INTEGER NOT NULL DEFAULT 0,
    "theme" TEXT NOT NULL DEFAULT 'system',
    "songApi" TEXT NOT NULL DEFAULT '',
    "songServer" TEXT NOT NULL DEFAULT 'netease',
    "songId" TEXT NOT NULL DEFAULT '',
    "siteUrl" TEXT NOT NULL DEFAULT '',
    "siteIcp" TEXT NOT NULL DEFAULT '',
    "siteMps" TEXT NOT NULL DEFAULT '',
    "siteStart" TEXT NOT NULL DEFAULT '',
    "siteLinksTitle" TEXT NOT NULL DEFAULT '我的网站',
    "siteLinksIcon" TEXT NOT NULL DEFAULT 'link',
    "friendLinksTitle" TEXT NOT NULL DEFAULT '友情链接',
    "iconfontUrl" TEXT NOT NULL DEFAULT '',
    "logoArtFont" BOOLEAN NOT NULL DEFAULT true,
    "logoFont" TEXT NOT NULL DEFAULT 'zcool-kuail',
    "loadingScreen" BOOLEAN NOT NULL DEFAULT true,
    "clickEffect" BOOLEAN NOT NULL DEFAULT true,
    "consoleEgg" BOOLEAN NOT NULL DEFAULT true,
    "showStats" BOOLEAN NOT NULL DEFAULT true,
    "dynamicTitle" BOOLEAN NOT NULL DEFAULT true,
    "topProgressBar" BOOLEAN NOT NULL DEFAULT true,
    "useRandomAvatar" BOOLEAN NOT NULL DEFAULT false,
    "welcomeEnabled" BOOLEAN NOT NULL DEFAULT true,
    "welcomeIndex" INTEGER NOT NULL DEFAULT 0,
    "welcomeMessages" TEXT NOT NULL DEFAULT '["欢迎来到本站～","很高兴遇见你，祝你愉快！","愿时光温柔，伴你左右","相逢即是缘分，欢迎光临","欢迎回来，好久不见"]',
    "siteTitle" TEXT NOT NULL DEFAULT '',
    "siteDescription" TEXT NOT NULL DEFAULT '',
    "siteKeywords" TEXT NOT NULL DEFAULT '',
    "accentColor" TEXT NOT NULL DEFAULT '',
    "glassOpacity" INTEGER NOT NULL DEFAULT 28,
    "glassBlur" INTEGER NOT NULL DEFAULT 16,
    "analyticsScript" TEXT NOT NULL DEFAULT '',
    "headScript" TEXT NOT NULL DEFAULT '',
    "timeFormat" TEXT NOT NULL DEFAULT '24',
    "showSeconds" BOOLEAN NOT NULL DEFAULT true,
    "dateFormat" TEXT NOT NULL DEFAULT 'YYYY年M月D日 dddd',
    "hitokotoType" TEXT NOT NULL DEFAULT '',
    "bgOverlay" INTEGER NOT NULL DEFAULT 0,
    "avatarShape" TEXT NOT NULL DEFAULT 'circle',
    "avatarBorderColor" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 迁移已有配置数据（显式列出全部列，保留原 id/createdAt/updatedAt 等字段）
INSERT INTO "Profile_new" (
    "id", "avatar", "siteIcon", "nickname", "bio", "github", "email", "bgApi",
    "weatherProvider", "amapKey", "amapSecretKey", "weatherCity", "txWeatherKey", "txWeatherSk",
    "coverType", "autoBGSwitchInterval", "wallpaperRefresh", "theme", "songApi", "songServer", "songId",
    "siteUrl", "siteIcp", "siteMps", "siteStart", "siteLinksTitle", "siteLinksIcon", "friendLinksTitle",
    "iconfontUrl", "logoArtFont", "logoFont", "loadingScreen", "clickEffect", "consoleEgg", "showStats",
    "dynamicTitle", "topProgressBar", "useRandomAvatar", "welcomeEnabled", "welcomeIndex", "welcomeMessages",
    "siteTitle", "siteDescription", "siteKeywords", "accentColor", "glassOpacity", "glassBlur",
    "analyticsScript", "headScript", "timeFormat", "showSeconds", "dateFormat", "hitokotoType",
    "bgOverlay", "avatarShape", "avatarBorderColor", "createdAt", "updatedAt"
)
SELECT
    "id", "avatar", "siteIcon", "nickname", "bio", "github", "email", "bgApi",
    "weatherProvider", "amapKey", "amapSecretKey", "weatherCity", "txWeatherKey", "txWeatherSk",
    "coverType", "autoBGSwitchInterval", "wallpaperRefresh", "theme", "songApi", "songServer", "songId",
    "siteUrl", "siteIcp", "siteMps", "siteStart", "siteLinksTitle", "siteLinksIcon", "friendLinksTitle",
    "iconfontUrl", "logoArtFont", "logoFont", "loadingScreen", "clickEffect", "consoleEgg", "showStats",
    "dynamicTitle", "topProgressBar", "useRandomAvatar", "welcomeEnabled", "welcomeIndex", "welcomeMessages",
    "siteTitle", "siteDescription", "siteKeywords", "accentColor", "glassOpacity", "glassBlur",
    "analyticsScript", "headScript", "timeFormat", "showSeconds", "dateFormat", "hitokotoType",
    "bgOverlay", "avatarShape", "avatarBorderColor", "createdAt", "updatedAt"
FROM "Profile";

DROP TABLE "Profile";
ALTER TABLE "Profile_new" RENAME TO "Profile";
