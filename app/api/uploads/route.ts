import { NextRequest } from "next/server";
import path from "node:path";
import { saveUpload, getImageSize, mimeFromExt, MAX_UPLOAD_SIZE } from "@/lib/uploads";
import { prisma } from "@/lib/db";
import { requireSession, error, internalError, isRateLimited, getClientIp } from "@/lib/server";

export const dynamic = "force-dynamic";

/** 上传图片文件（头像/图标/壁纸）：需登录，返回 /api/uploads/file/xxx URL */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();
    if (!session) {
      return error("未授权", 401);
    }

    // 【Rate Limit】文件上传消耗带宽/磁盘：按 IP 限流（每 60s 最多 3 次）
    if (isRateLimited(`uploads:${getClientIp(request) || "unknown"}`, 3)) return error("操作过于频繁，请稍后再试", 429);

    // 早期拒绝：formData() 会把整个 multipart 缓冲进内存，等到 saveUpload 里
    // 再校验 10MB 已无法阻止内存耗尽。此处按「文件上限 + multipart 边界开销」预判
    // （chunked 传输下该头可缺失，反代的 client_max_body_size 才是硬上限）。
    const declared = Number(request.headers.get("content-length") || 0);
    if (declared > MAX_UPLOAD_SIZE + 128 * 1024) {
      return error("文件超过 10MB 限制", 400);
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return error("缺少 file 字段或类型不正确");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    let url: string;
    try {
      url = await saveUpload(buffer);
    } catch (e) {
      return error(e instanceof Error ? e.message : "文件校验失败", 400);
    }

    // 尽力而为地把上传登记进媒体库（媒体管理入口能看到各面板已上传的图片）。
    // 登记失败不影响本次上传（主流程仍返回 url）。
    // 【High 修复】跳过 width/height 为 0 的损坏图片记录，避免后续系统按 0x0 处理
    try {
      const fileName = decodeURIComponent(url.split("/").pop() || "");
      const ext = path.extname(fileName);
      const { width, height } = getImageSize(buffer);
      await prisma.imageAsset.create({
        data: {
          url,
          fileName,
          mimeType: mimeFromExt(ext),
          size: buffer.byteLength,
          width: width > 0 && height > 0 ? width : undefined,
          height: width > 0 && height > 0 ? height : undefined,
          usage: "",
        },
      });
    } catch (mediaErr) {
      console.error("[uploads] 登记媒体库失败（可忽略）", mediaErr);
    }

    return new Response(JSON.stringify({ ok: true, url }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        // 【Critical 修复】X-Content-Type-Options: nosniff 禁止浏览器 MIME 嗅探
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return internalError("[POST /api/uploads] 上传失败", e);
  }
}
