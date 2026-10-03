import { NextRequest } from "next/server";
import {
  clearWallpaperCache,
  deleteCachedWallpaper,
  listCachedWallpapers,
} from "@/lib/wallpaperCache";
import { requireSession, error, internalError, getClientIp, writeOperationLog } from "@/lib/server";

export const dynamic = "force-dynamic";

/**
 * 壁纸缓存管理（后台「媒体库 → 壁纸缓存」分区）。
 *
 * 这里只管 data/wallpapers 下的自动缓存：查看（GET）、删单张 / 全部清空（DELETE）。
 * 刻意**不**登记 ImageAsset：缓存会被自动裁剪（上限 100 张），生命周期与媒体库里的
 * 用户内容不同，登记进库迟早会留下「记录还在、文件已被删」的死链接。
 */

// 查看缓存内容与占用
export async function GET() {
  try {
    const session = await requireSession();
    if (!session) {
      return error("未授权", 401);
    }
    return Response.json(await listCachedWallpapers());
  } catch (e) {
    return internalError("[GET /api/wallpaper/cache] 读取缓存失败", e);
  }
}

// 删除缓存：?fileName=xxx 删单张；?all=1 全部清空
export async function DELETE(request: NextRequest) {
  try {
    const session = await requireSession();
    if (!session) {
      return error("未授权", 401);
    }

    const username = session.user?.name || "unknown";
    const ip = getClientIp(request);
    const sp = request.nextUrl.searchParams;

    // 清空必须显式传 all=1：避免任何一次「少带了 fileName 的请求」变成清库
    if (sp.get("all") === "1") {
      const removed = await clearWallpaperCache();
      await writeOperationLog({
        module: "media",
        action: "delete",
        username,
        summary: `清空壁纸缓存（${removed} 张）`,
        detail: JSON.stringify({ scope: "wallpaper-cache" }),
        ip,
      });
      return Response.json({ ok: true, removed });
    }

    const fileName = sp.get("fileName")?.trim() || "";
    if (!fileName) {
      return error("缺少 fileName 参数");
    }
    const hit = await deleteCachedWallpaper(fileName);
    if (!hit) {
      return error("缓存中不存在该文件", 404);
    }
    await writeOperationLog({
      module: "media",
      action: "delete",
      username,
      summary: `删除壁纸缓存 ${fileName}`,
      detail: JSON.stringify({ scope: "wallpaper-cache" }),
      ip,
    });
    return Response.json({ ok: true, removed: 1 });
  } catch (e) {
    return internalError("[DELETE /api/wallpaper/cache] 删除缓存失败", e);
  }
}
