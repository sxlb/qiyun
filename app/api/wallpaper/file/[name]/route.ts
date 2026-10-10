import { NextRequest } from "next/server";
import { readCachedWallpaper } from "@/lib/wallpaperCache";
import { serveFile } from "@/lib/file-serving";
import { parseThumbWidth } from "@/lib/mediaThumb";
import { getOrCreateThumbnail } from "@/lib/thumbnails";

export const dynamic = "force-dynamic";

/**
 * GET /api/wallpaper/file/[name]
 * 返回本地缓存的壁纸文件。文件名严格校验（防路径穿越），
 * 文件名唯一（时间戳+随机串），可长缓存。
 *
 * 带 ?w=<宽度> 时返回缩略图（后台网格用）—— 壁纸缓存最多 300 张，
 * 原图直出时展开一次就要解码上百张大图。生成失败回退原图。
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const width = parseThumbWidth(request.nextUrl.searchParams.get("w"));
  if (width) {
    const thumb = await getOrCreateThumbnail("wallpaper", name, width, async () => {
      const file = await readCachedWallpaper(name);
      return file?.buffer ?? null;
    });
    if (thumb) return serveFile({ buffer: thumb, contentType: "image/webp" });
  }
  return serveFile(await readCachedWallpaper(name));
}