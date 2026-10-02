import { NextRequest } from "next/server";
import path from "node:path";
import { prisma } from "@/lib/db";
import { readUpload, saveUpload, getImageSize, mimeFromExt } from "@/lib/uploads";
import {
  requireSession,
  error,
  internalError,
  getClientIp,
  writeOperationLog,
} from "@/lib/server";

export const dynamic = "force-dynamic";

// 复制媒体资产：读取原文件 → 以新文件名写入磁盘 → 登记新记录（便于复用入口）
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    if (!session) {
      return error("未授权", 401);
    }

    const { id: idRaw } = await params;
    const id = parseInt(idRaw, 10);
    if (Number.isNaN(id) || id < 1) {
      return error("无效的资源 id");
    }

    const src = await prisma.imageAsset.findUnique({ where: { id } });
    if (!src) {
      return error("资源不存在", 404);
    }

    const existing = await readUpload(src.fileName);
    if (!existing) {
      return error("源文件不存在，无法复制", 404);
    }

    const newUrl = await saveUpload(existing.buffer);
    const newName = decodeURIComponent(newUrl.split("/").pop() || "");
    const ext = path.extname(newName);
    const { width, height } = getImageSize(existing.buffer);

    const asset = await prisma.imageAsset.create({
      data: {
        url: newUrl,
        fileName: newName,
        mimeType: mimeFromExt(ext),
        size: existing.buffer.byteLength,
        width,
        height,
        usage: src.usage,
      },
    });

    const username = session.user?.name || "unknown";
    await writeOperationLog({
      module: "media",
      action: "create",
      username,
      summary: `复制图片 ${src.fileName} → ${newName}`,
      detail: JSON.stringify({ from: src.url, url: newUrl, usage: src.usage }),
      ip: getClientIp(_request),
    });

    return Response.json({ ok: true, item: asset }, { status: 201 });
  } catch (e) {
    return internalError("[POST /api/media/copy] 复制失败", e);
  }
}