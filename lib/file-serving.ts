/** 通用静态文件服务逻辑：被 /api/wallpaper/file/[name] 和 /api/uploads/file/[name] 复用 */
export function serveFile(file: { buffer: number[] | Uint8Array; contentType: string } | null) {
  if (!file) {
    return new Response("Not Found", { status: 404 });
  }
  return new Response(new Uint8Array(file.buffer), {
    headers: {
      "Content-Type": file.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
