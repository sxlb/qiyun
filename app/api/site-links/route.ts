import { prisma } from "@/lib/db";
import { siteLinkCreateSchema } from "@/lib/validation";
import { createLinkListApi, toLinkDelegate } from "@/lib/server";

export const dynamic = "force-dynamic";

const api = createLinkListApi({
  module: "site-links",
  label: "网站链接",
  schema: siteLinkCreateSchema,
  delegate: toLinkDelegate(prisma.siteLink),
  txDelegate: (tx) => toLinkDelegate((tx as { siteLink: unknown }).siteLink),
});

export const { GET, POST, PUT } = api;
