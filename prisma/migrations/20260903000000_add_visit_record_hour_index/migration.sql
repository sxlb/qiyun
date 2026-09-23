-- 访问明细按 date 范围过滤后再按 hour 聚合（/api/stats/dashboard）是高频查询；
-- 新增 (date, hour) 组合索引覆盖该路径（也覆盖纯日期范围扫描的左前缀）。
-- 组合索引已能替代单列 date 索引，删除单列索引减少写放大。
DROP INDEX IF EXISTS "VisitRecord_date_idx";
CREATE INDEX "VisitRecord_date_hour_idx" ON "VisitRecord"("date", "hour");
