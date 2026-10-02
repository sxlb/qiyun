-- RedefineTables
-- 删除已停用的外部服务配置字段：randomImageApi（loremflickr 改为付费授权）、
-- openverseApi（大陆网络长期不可达）。其余表的重建为历史 TIMESTAMP(3) 漂移的顺带修复，数据无损。
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_FriendLink" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_FriendLink" ("createdAt", "description", "icon", "id", "name", "sort", "updatedAt", "url") SELECT "createdAt", "description", "icon", "id", "name", "sort", "updatedAt", "url" FROM "FriendLink";
DROP TABLE "FriendLink";
ALTER TABLE "new_FriendLink" RENAME TO "FriendLink";
CREATE TABLE "new_OperationLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "ip" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_OperationLog" ("action", "createdAt", "detail", "id", "ip", "module", "summary", "username") SELECT "action", "createdAt", "detail", "id", "ip", "module", "summary", "username" FROM "OperationLog";
DROP TABLE "OperationLog";
ALTER TABLE "new_OperationLog" RENAME TO "OperationLog";
CREATE INDEX "OperationLog_createdAt_idx" ON "OperationLog"("createdAt");
CREATE INDEX "OperationLog_module_createdAt_idx" ON "OperationLog"("module", "createdAt");
CREATE TABLE "new_Profile" (
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
    "musicAutoplay" BOOLEAN NOT NULL DEFAULT false,
    "siteUrl" TEXT NOT NULL DEFAULT '',
    "siteIcp" TEXT NOT NULL DEFAULT '',
    "siteMps" TEXT NOT NULL DEFAULT '',
    "siteStart" TEXT NOT NULL DEFAULT '',
    "siteLinksTitle" TEXT NOT NULL DEFAULT '我的网站',
    "siteLinksIcon" TEXT NOT NULL DEFAULT 'link',
    "friendLinksTitle" TEXT NOT NULL DEFAULT '友情链接',
    "iconfontUrl" TEXT NOT NULL DEFAULT '',
    "logoArtFont" BOOLEAN NOT NULL DEFAULT true,
    "customFontEnabled" BOOLEAN NOT NULL DEFAULT false,
    "customFontFamily" TEXT NOT NULL DEFAULT '',
    "customFontScope" TEXT NOT NULL DEFAULT 'nickname',
    "loadingScreen" BOOLEAN NOT NULL DEFAULT true,
    "clickEffect" BOOLEAN NOT NULL DEFAULT true,
    "consoleEgg" BOOLEAN NOT NULL DEFAULT true,
    "showStats" BOOLEAN NOT NULL DEFAULT true,
    "dynamicTitle" BOOLEAN NOT NULL DEFAULT true,
    "topProgressBar" BOOLEAN NOT NULL DEFAULT true,
    "seasonalEffectEnabled" BOOLEAN NOT NULL DEFAULT false,
    "useRandomAvatar" BOOLEAN NOT NULL DEFAULT false,
    "commandPalette" BOOLEAN NOT NULL DEFAULT true,
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
    "siteFooterHtml" TEXT NOT NULL DEFAULT '',
    "wallpaperLandscapeApi" TEXT NOT NULL DEFAULT '',
    "wallpaperAnimeApi" TEXT NOT NULL DEFAULT '',
    "randomAvatarApi" TEXT NOT NULL DEFAULT '',
    "iconifyApi" TEXT NOT NULL DEFAULT '',
    "faviconApi" TEXT NOT NULL DEFAULT '',
    "bingWallpaperApi" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Profile" ("accentColor", "amapKey", "amapSecretKey", "analyticsScript", "autoBGSwitchInterval", "avatar", "avatarBorderColor", "avatarShape", "bgApi", "bgOverlay", "bingWallpaperApi", "bio", "clickEffect", "commandPalette", "consoleEgg", "coverType", "createdAt", "customFontEnabled", "customFontFamily", "customFontScope", "dateFormat", "dynamicTitle", "email", "faviconApi", "friendLinksTitle", "github", "glassBlur", "glassOpacity", "headScript", "hitokotoType", "iconfontUrl", "iconifyApi", "id", "loadingScreen", "logoArtFont", "musicAutoplay", "nickname", "randomAvatarApi", "seasonalEffectEnabled", "showSeconds", "showStats", "siteDescription", "siteFooterHtml", "siteIcon", "siteIcp", "siteKeywords", "siteLinksIcon", "siteLinksTitle", "siteMps", "siteStart", "siteTitle", "siteUrl", "songApi", "songId", "songServer", "theme", "timeFormat", "topProgressBar", "txWeatherKey", "txWeatherSk", "updatedAt", "useRandomAvatar", "wallpaperAnimeApi", "wallpaperLandscapeApi", "wallpaperRefresh", "weatherCity", "weatherProvider", "welcomeEnabled", "welcomeIndex", "welcomeMessages") SELECT "accentColor", "amapKey", "amapSecretKey", "analyticsScript", "autoBGSwitchInterval", "avatar", "avatarBorderColor", "avatarShape", "bgApi", "bgOverlay", "bingWallpaperApi", "bio", "clickEffect", "commandPalette", "consoleEgg", "coverType", "createdAt", "customFontEnabled", "customFontFamily", "customFontScope", "dateFormat", "dynamicTitle", "email", "faviconApi", "friendLinksTitle", "github", "glassBlur", "glassOpacity", "headScript", "hitokotoType", "iconfontUrl", "iconifyApi", "id", "loadingScreen", "logoArtFont", "musicAutoplay", "nickname", "randomAvatarApi", "seasonalEffectEnabled", "showSeconds", "showStats", "siteDescription", "siteFooterHtml", "siteIcon", "siteIcp", "siteKeywords", "siteLinksIcon", "siteLinksTitle", "siteMps", "siteStart", "siteTitle", "siteUrl", "songApi", "songId", "songServer", "theme", "timeFormat", "topProgressBar", "txWeatherKey", "txWeatherSk", "updatedAt", "useRandomAvatar", "wallpaperAnimeApi", "wallpaperLandscapeApi", "wallpaperRefresh", "weatherCity", "weatherProvider", "welcomeEnabled", "welcomeIndex", "welcomeMessages" FROM "Profile";
DROP TABLE "Profile";
ALTER TABLE "new_Profile" RENAME TO "Profile";
CREATE TABLE "new_Project" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL DEFAULT '',
    "image" TEXT NOT NULL DEFAULT '',
    "tags" TEXT NOT NULL DEFAULT '',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Project" ("createdAt", "description", "enabled", "featured", "id", "image", "sort", "tags", "title", "updatedAt", "url") SELECT "createdAt", "description", "enabled", "featured", "id", "image", "sort", "tags", "title", "updatedAt", "url" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";
CREATE TABLE "new_SiteLink" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_SiteLink" ("createdAt", "icon", "id", "name", "sort", "updatedAt", "url") SELECT "createdAt", "icon", "id", "name", "sort", "updatedAt", "url" FROM "SiteLink";
DROP TABLE "SiteLink";
ALTER TABLE "new_SiteLink" RENAME TO "SiteLink";
CREATE TABLE "new_Skill" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 0,
    "icon" TEXT NOT NULL DEFAULT '',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Skill" ("createdAt", "icon", "id", "level", "name", "sort", "updatedAt") SELECT "createdAt", "icon", "id", "level", "name", "sort", "updatedAt" FROM "Skill";
DROP TABLE "Skill";
ALTER TABLE "new_Skill" RENAME TO "Skill";
CREATE TABLE "new_SocialLink" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "tip" TEXT NOT NULL DEFAULT '',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_SocialLink" ("createdAt", "icon", "id", "name", "sort", "tip", "updatedAt", "url") SELECT "createdAt", "icon", "id", "name", "sort", "tip", "updatedAt", "url" FROM "SocialLink";
DROP TABLE "SocialLink";
ALTER TABLE "new_SocialLink" RENAME TO "SocialLink";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
