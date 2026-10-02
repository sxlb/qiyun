import { NextRequest } from "next/server";
import { readUpload } from "@/lib/uploads";
import { serveFile } from "@/lib/file-serving";

export const dynamic = "force-dynamic";

/** GET /api/uploads/file/[name]：返回上传的文件（白名单校验，长缓存） */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  return serveFile(await readUpload(name));
}
