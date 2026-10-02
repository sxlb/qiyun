-- 【VULN-04】访问明细隐私脱敏：新增两列，停止持久化明文 IP
--
-- ipHash：IP 的 HMAC-SHA256 哈希（截断 32 位 hex），仅用于「独立访客数」去重，不可逆。
-- region：上报时经 ip2region 离线库解析出的地域标签（省 / 国家 / 局域网未知），
--         使统计查询不再依赖原始 IP。
--
-- 原 ip 列保留（新记录写入空字符串），以兼容尚未脱敏的历史数据：
-- 执行 `node scripts/backfill-visit-privacy.mjs` 可把历史记录回填 region/ipHash 并清空 ip，
-- 完成彻底脱敏；未执行时地域统计会回退为「现场解析历史 IP」，功能不退化。
ALTER TABLE "VisitRecord" ADD COLUMN "ipHash" TEXT NOT NULL DEFAULT '';
ALTER TABLE "VisitRecord" ADD COLUMN "region" TEXT NOT NULL DEFAULT '';

-- 地域分布查询：先按 date 范围过滤，再按 region 聚合
CREATE INDEX "VisitRecord_date_region_idx" ON "VisitRecord"("date", "region");
