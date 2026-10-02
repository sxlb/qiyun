-- 右上角欢迎通知：启用开关 + 当前生效欢迎语索引 + 欢迎语列表（JSON 字符串数组，默认 5 句）
ALTER TABLE "Profile" ADD COLUMN "welcomeEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Profile" ADD COLUMN "welcomeIndex" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Profile" ADD COLUMN "welcomeMessages" TEXT NOT NULL DEFAULT '["欢迎来到本站～","很高兴遇见你，祝你愉快！","愿时光温柔，伴你左右","相逢即是缘分，欢迎光临","欢迎回来，好久不见"]';
