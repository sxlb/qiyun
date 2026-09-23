import { NextRequest } from "next/server";
import path from "node:path";
import { prisma } from "@/lib/db";
import { saveUpload, getImageSize, mimeFromExt, MAX_UPLOAD_SIZE } from "@/lib/uploads";
import {
  requireSession,
  error,
  internalError,
  getClientIp,
  writeOperationLog,
} from "@/lib/server";

export const dynamic = "force-dynamic";

// 媒体库：查询（按 usage 过滤 + 分页）与上传（写入文件并登记 ImageAsset）
export async function GET(request: NextRequest) {
  try {
    const session = await requireSession();
    if (!session) {
      return error("未授权", 401);
    }

    const sp = request.nextUrl.searchParams;
    const usage = sp.get("usage")?.trim() || "";

    const rawPage = parseInt(sp.get("page") || "1", 10);
    const page = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;
    const rawPageSize = parseInt(sp.get("pageSize") || "24", 10);
    const pageSize = isNaN(rawPageSize) ? 24 : Math.min(Math.max(rawPageSize, 1), 100);

    const where = usage ? { usage } : {};
    const [total, items] = await Promise.all([
      prisma.imageAsset.count({ where }),
      prisma.imageAsset.findMany({
        where,
        orderBy: { id: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return Response.json({ items, total, page, pageSize });
  } catch (e) {
    return internalError("[GET /api/media] 查询失败", e);
  }
}

// 上传图片并登记进媒体库：multipart 字段 file + 可选 usage
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();
    if (!session) {
      return error("未授权", 401);
    }

    // 早期拒绝超大请求（同 /api/uploads）：formData() 会先整体缓冲进内存
    const declared = Number(request.headers.get("content-length") || 0);
    if (declared > MAX_UPLOAD_SIZE + 128 * 1024) {
      return error("文件超过 10MB 限制", 400);
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return error("缺少 file 字段或类型不正确");
    }
    const usage = (form.get("usage") as string)?.trim() || "";

    const buffer = Buffer.from(await file.arrayBuffer());
    let url: string;
    try {
      url = await saveUpload(buffer);
    } catch (e) {
      return error(e instanceof Error ? e.message : "文件校验失败", 400);
    }

    const fileName = decodeURIComponent(url.split("/").pop() || "");
    const ext = path.extname(fileName);
    const size = buffer.byteLength;
    const { width, height } = getImageSize(buffer);

    const asset = await prisma.imageAsset.create({
      data: {
        url,
        fileName,
        mimeType: mimeFromExt(ext),
        size,
        width,
        height,
        usage,
      },
    });

    const username = session.user?.name || "unknown";
    await writeOperationLog({
      module: "media",
      action: "create",
      username,
      summary: `上传图片 ${fileName}`,
      detail: JSON.stringify({ url, usage, size, width, height }),
      ip: getClientIp(request),
    });

    return Response.json({ ok: true, item: asset }, { status: 201 });
  } catch (e) {
    return internalError("[POST /api/media] 上传失败", e);
  }
}