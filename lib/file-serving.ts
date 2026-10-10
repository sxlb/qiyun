/** 通用静态文件服务逻辑：被 /api/wallpaper/file/[name] 和 /api/uploads/file/[name] 复用 */
export function serveFile(file: { buffer: number[] | Uint8Array; contentType: string } | null) {
  if (!file) {
    return new Response("Not Found", { status: 404 });
  }
  // 已有字节视图时直接复用，不再 new Uint8Array(buffer) 复制整份文件。
  // 后台媒体库一页 24 张、壁纸缓存最多 300 张，且都是原图（单张可达数 MB）：
  // 同时取图时逐张复制会在 Node 单线程上堆积大量内存拷贝并阻塞事件循环，
  // 让同一时间发出的分页 / 列表接口一起变慢 —— 这正是「图片没加载完页面就卡」
  // 在服务端一侧的成因。number[] 入参（测试用）仍需转换。
  //
  // 断言说明：TS 5.7 起 Uint8Array 带泛型参数，Node 的 Buffer 是
  // Uint8Array<ArrayBufferLike>，而 DOM 的 BodyInit 只接受 ArrayBufferView<ArrayBuffer>；
  // 两者运行期完全兼容（Buffer 本就是 Uint8Array 子类），故按运行期事实断言。
  const body = (file.buffer instanceof Uint8Array
    ? file.buffer
    : new Uint8Array(file.buffer)) as unknown as BodyInit;
  return new Response(body, {
    headers: {
      "Content-Type": file.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}