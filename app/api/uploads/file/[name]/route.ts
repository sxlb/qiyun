import { NextRequest } from "next/server";
import { readUpload } from "@/lib/uploads";
import { serveFile } from "@/lib/file-serving";
import { parseThumbWidth } from "@/lib/mediaThumb";
import { getOrCreateThumbnail } from "@/lib/thumbnails";

export const dynamic = "force-dynamic";

/**
 * GET /api/uploads/file/[name]：返回上传的文件（白名单校验，长缓存）。
 *
 * 带 ?w=<宽度> 时返回缩略图（后台网格用）：原图直出会让浏览器一次性解码
 * 多张大图，是「图片没加载完页面就卡」的主要成因。宽度按白名单校验，
 * 非法值直接回退原图；生成失败（如 ICO 这类 sharp 处理不了的格式）同样回退。
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const width = parseThumbWidth(request.nextUrl.searchParams.get("w"));
  if (width) {
    // 懒加载原图：命中缩略图缓存时不会读原文件
    const thumb = await getOrCreateThumbnail("uploads", name, width, async () => {
      const file = await readUpload(name);
      return file?.buffer ?? null;
    });
    if (thumb) return serveFile({ buffer: thumb, contentType: "image/webp" });
  }
  return serveFile(await readUpload(name));
}