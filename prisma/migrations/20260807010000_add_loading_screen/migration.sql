-- 首页全屏加载动画开关（默认开启）
ALTER TABLE "Profile" ADD COLUMN "loadingScreen" BOOLEAN NOT NULL DEFAULT true;
