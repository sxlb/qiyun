-- 链接点击统计增加来源类型 kind，并把唯一键由 linkId 改为 (kind, linkId)。
--
-- 背景：SiteLink / FriendLink / Project 三张表的自增 id 属于彼此独立的空间，而原唯一键只有
-- linkId，导致「作品 #3」的点击会被累加到「网站链接 #3」上（计数串台，后台「热门链接」失真）。
--
-- 存量数据一律标记为 site：迁移前该接口不区分来源，历史行的语义本就是「网站/友链」混合计数，
-- 归入 site 不会造成新的错误，也不会丢失任何计数。

ALTER TABLE "SiteLinkClick" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'site';

DROP INDEX "SiteLinkClick_linkId_key";

CREATE UNIQUE INDEX "SiteLinkClick_kind_linkId_key" ON "SiteLinkClick"("kind", "linkId");
