import { NextRequest } from "next/server";
import { readCachedWallpaper } from "@/lib/wallpaperCache";
import { serveFile } from "@/lib/file-serving";

export const dynamic = "force-dynamic";

/**
 * GET /api/wallpaper/file/[name]
 * 返回本地缓存的壁纸文件。文件名严格校验（防路径穿越），
 * 文件名唯一（时间戳+随机串），可长缓存。
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  return serveFile(await readCachedWallpaper(name));
}
