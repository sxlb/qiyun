-- 为首页季节装饰特效（萤火虫/雪花/灯笼）提供独立开关控制。
ALTER TABLE "Profile" ADD COLUMN "seasonalEffectEnabled" INTEGER NOT NULL DEFAULT 0;
