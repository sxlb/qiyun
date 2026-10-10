/**
 * 后台图片网格的缩略图约定（纯函数，客户端组件可安全引用）。
 *
 * 背景：媒体库与壁纸缓存都是原图直出 —— 网格位置只有两三百像素，却要下载并
 * 解码整张原图（后台单张可达数 MB，解码后位图数十 MB），一页 24 张、缓存最多
 * 300 张，主线程被解码任务占满。这里约定「网格一律请求 ?w=<宽度>」，由
 * /api/uploads|wallpaper/file 动态生成并落盘缓存缩略图。
 *
 * 宽度走白名单而非任意值：否则 ?w=99999 会变成让服务端放大图片的放大攻击。
 * 与 lib/thumbnails.ts（服务端，引 sharp）分开，避免客户端组件连带打包原生库。
 */

/** 允许请求的缩略图宽度（px）。只缩不放由服务端 withoutEnlargement 保证 */
export const THUMB_WIDTHS: readonly number[] = [320, 640];

/** 网格默认宽度：约等于 4 列布局下的卡片宽度 */
export const GRID_THUMB_WIDTH = 320;

/** 高分屏用的高一档宽度 */
export const GRID_THUMB_WIDTH_2X = 640;

/** 解析并校验 ?w= 参数；非法或缺失返回 null（调用方回退原图） */
export function parseThumbWidth(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return THUMB_WIDTHS.includes(n) ? n : null;
}

/** 本站内部图片路径前缀：只有这两种走缩略图，外链原样返回 */
const INTERNAL_PREFIXES = ["/api/uploads/file/", "/api/wallpaper/file/"];

/** 给内部图片地址追加缩略图宽度；外链、空值原样返回 */
export function thumbUrl(url: string, width: number = GRID_THUMB_WIDTH): string {
  if (!url || !INTERNAL_PREFIXES.some((prefix) => url.startsWith(prefix))) return url;
  return `${url}${url.includes("?") ? "&" : "?"}w=${width}`;
}

/**
 * 网格缩略图的 src / srcSet 组合。
 * 带 2x 描述符是为了高分屏：单给 320 的话，在 280px 的卡片上会明显发糊。
 */
export function gridThumbAttrs(url: string): { src: string; srcSet: string } {
  const oneX = thumbUrl(url, GRID_THUMB_WIDTH);
  const twoX = thumbUrl(url, GRID_THUMB_WIDTH_2X);
  return { src: oneX, srcSet: `${oneX} 1x, ${twoX} 2x` };
}