-- 补充缺失迁移：useRandomAvatar 字段此前仅存在于 prisma/schema.prisma，
-- 未生成对应迁移文件，导致 migrate deploy（Docker 全新部署）后 Profile 表
-- 缺少该列，Prisma 写入/查询 Profile 时报 P2022 错误。
-- 此迁移与已有数据完全兼容（带默认值 false），幂等可重复部署。
ALTER TABLE "Profile" ADD COLUMN "useRandomAvatar" BOOLEAN NOT NULL DEFAULT false;
