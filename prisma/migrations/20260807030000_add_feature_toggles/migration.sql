-- 首页功能开关：点击粒子特效 / 控制台彩蛋 / 访问统计 / 动态标题 / 顶部音乐进度条
ALTER TABLE "Profile" ADD COLUMN "clickEffect" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Profile" ADD COLUMN "consoleEgg" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Profile" ADD COLUMN "showStats" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Profile" ADD COLUMN "dynamicTitle" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Profile" ADD COLUMN "topProgressBar" BOOLEAN NOT NULL DEFAULT true;
