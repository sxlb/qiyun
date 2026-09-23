import { prisma } from "@/lib/db";
import type { MetadataRoute } from "next";

export const dynamic = "force-dynamic";

/**
 * 站点地图：配置 siteUrl 后输出首页 URL，否则返回空数组。
 *
 * 说明：随笔/文章功能已下线，其 /articles 路由不再存在，
 * 因此这里不再输出文章列表页与详情页 URL（此前会向搜索引擎提交 404 死链）。
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const profile = await prisma.profile.findFirst({ orderBy: { id: "asc" } });
  const siteUrl = profile?.siteUrl?.trim().replace(/\/+$/, "");
  if (!profile || !siteUrl) return [];

  return [
    {
      url: siteUrl,
      lastModified: profile.updatedAt,
      changeFrequency: "daily",
      priority: 1,
    },
  ];
}
