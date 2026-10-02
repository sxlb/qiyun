import { prisma } from "@/lib/db";
import { socialLinkCreateSchema } from "@/lib/validation";
import { createLinkListApi, toLinkDelegate } from "@/lib/server";

export const dynamic = "force-dynamic";

const api = createLinkListApi({
  module: "social-links",
  label: "社交链接",
  schema: socialLinkCreateSchema,
  delegate: toLinkDelegate(prisma.socialLink),
  txDelegate: (tx) => toLinkDelegate((tx as { socialLink: unknown }).socialLink),
});

export const { GET, POST, PUT } = api;
