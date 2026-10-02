-- 更新记录：新增 method 列，标识本次更新采用的方式（build=服务器自建构建 / image=拉取发布镜像）
ALTER TABLE "UpdateRecord" ADD COLUMN "method" TEXT NOT NULL DEFAULT 'build';