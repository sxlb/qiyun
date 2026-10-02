import { NextRequest } from "next/server";
import path from "node:path";
import { promises as fs } from "node:fs";
import { prisma } from "@/lib/db";
import { getUploadsDir, isSafeFileName } from "@/lib/uploads";
import {
  requireSession,
  error,
  internalError,
  getClientIp,
  writeOperationLog,
} from "@/lib/server";

export const dynamic = "force-dynamic";

// 删除媒体资产：删除磁盘文件 + 数据库记录 + 写审计日志
export async function DELETE(
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

    const asset = await prisma.imageAsset.findUnique({ where: { id } });
    if (!asset) {
      return error("资源不存在", 404);
    }

    // 顺序很关键：数据库记录才是「事实源」，磁盘文件只是它的附属物。
    // 必须先删记录再删文件——反过来的话，一旦删记录失败，留下的记录会永远指向一个
    // 已被删除的文件（媒体库里该图永久 404，而且没有任何入口能修复）。
    await prisma.imageAsset.delete({ where: { id } });

    // 删除磁盘文件（尽力而为，失败不阻断；同时用安全名校验防目录穿越）
    if (isSafeFileName(asset.fileName)) {
      const filePath = path.join(getUploadsDir(), asset.fileName);
      if (filePath.startsWith(getUploadsDir() + path.sep)) {
        await fs.rm(filePath, { force: true }).catch(() => {});
      }
    }

    const username = session.user?.name || "unknown";
    await writeOperationLog({
      module: "media",
      action: "delete",
      username,
      summary: `删除图片 ${asset.fileName}`,
      detail: JSON.stringify({ url: asset.url, usage: asset.usage }),
      ip: getClientIp(_request),
    });

    return Response.json({ ok: true });
  } catch (e) {
    return internalError("[DELETE /api/media] 删除失败", e);
  }
}