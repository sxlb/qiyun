-- 新增"是否需要强制改密"标记：默认账号（admin/123456）首次登录提示改密，改密后置为 false
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;