-- 壁纸源按设备分流：风景 / 动漫各新增一个"手机端"地址，原字段语义为"电脑端"。
-- 两者都带默认空串（未配置时回退 lib/external-api.ts 的内置默认值），加列不影响存量数据。
ALTER TABLE "Profile" ADD COLUMN "wallpaperLandscapeApiMobile" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Profile" ADD COLUMN "wallpaperAnimeApiMobile" TEXT NOT NULL DEFAULT '';
