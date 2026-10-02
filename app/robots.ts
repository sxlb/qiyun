import { prisma } from "@/lib/db";
import type { MetadataRoute } from "next";

export const dynamic = "force-dynamic";

/** 爬虫规则：允许全站；配置 siteUrl 后声明 sitemap 地址 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const profile = await prisma.profile.findFirst({ orderBy: { id: "asc" } });
  const siteUrl = profile?.siteUrl?.trim().replace(/\/+$/, "");
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    ...(siteUrl ? { sitemap: `${siteUrl}/sitemap.xml` } : {}),
  };
}
