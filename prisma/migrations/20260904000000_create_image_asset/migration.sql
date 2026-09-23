-- 媒体图库（F2）：集中登记上传的图片资产，供后台网格浏览 / 按类型过滤 / 复制 / 删除。
CREATE TABLE "ImageAsset" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "url" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'image/png',
    "size" INTEGER NOT NULL DEFAULT 0,
    "width" INTEGER NOT NULL DEFAULT 0,
    "height" INTEGER NOT NULL DEFAULT 0,
    "usage" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ImageAsset_url_key" ON "ImageAsset"("url");
CREATE INDEX "ImageAsset_mimeType_idx" ON "ImageAsset"("mimeType");