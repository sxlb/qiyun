import { prisma } from "@/lib/db";
import { friendLinkCreateSchema } from "@/lib/validation";
import { createLinkListApi, toLinkDelegate } from "@/lib/server";

export const dynamic = "force-dynamic";

const api = createLinkListApi({
  module: "friend-links",
  label: "友情链接",
  schema: friendLinkCreateSchema,
  delegate: toLinkDelegate(prisma.friendLink),
  txDelegate: (tx) => toLinkDelegate((tx as { friendLink: unknown }).friendLink),
});

export const { GET, POST, PUT } = api;
