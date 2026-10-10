import { promises as fs } from "node:fs";
import path from "node:path";
import { THUMB_WIDTHS } from "@/lib/mediaThumb";

/**
 * 缩略图生成与磁盘缓存（后台图片网格专用）。
 *
 * 为什么需要：媒体库与壁纸缓存都是原图直出，网格位置却只有两三百像素。
 * 一张 4000×3000 的照片解码后位图约 48MB，一页 24 张同时解码足以把主线程占满，
 * 表现为「图片还没加载完，页面先卡住」。缩略图把网络体积与解码量都降一到两个
 * 数量级（320px WebP 通常 20~30KB）。
 *
 * 几个刻意的设计：
 * - **懒加载原图**：命中缩略图缓存时根本不读原文件。否则「读 3MB 原图 → 发现
 *   缩略图已存在 → 丢掉原图」白费一次磁盘 IO 与内存分配。
 * - **并发去重**：同一张图的同一尺寸同时被请求时只生成一次，避免重复跑 sharp。
 * - **原子写**：先写临时文件再 rename，防止半截文件被后续请求当成有效缓存读出。
 * - **失败回退**：sharp 处理不了的格式（如 ICO）或损坏文件返回 null，
 *   由路由回退到原图，而不是让整个网格出现破图。
 * - 缓存目录与 data/wallpapers 同级，随 Docker 数据卷一起持久化。
 */

/**
 * 缩略图根目录。
 * 默认与 data/wallpapers 同级，随 Docker 数据卷持久化；
 * 单测通过 QIYUN_THUMB_DIR 指到临时目录，避免污染项目 data/。
 */
function getThumbRoot(): string {
  return process.env.QIYUN_THUMB_DIR || path.join(process.cwd(), "data", "thumbs");
}

/** 缩略图路径：data/thumbs/<来源>/<宽度>/<原文件名>.webp */
function thumbPath(source: string, fileName: string, width: number): string {
  return path.join(getThumbRoot(), source, String(width), `${fileName}.webp`);
}

/** WebP 质量：后台缩略图，78 在体积与观感间比较平衡 */
const WEBP_QUALITY = 78;

/** 正在生成的缩略图（键为落盘路径）：并发请求同一张时复用同一次生成 */
const inFlight = new Map<string, Promise<Buffer | null>>();

/**
 * 按需加载 sharp。
 *
 * 刻意用动态 import 而非顶层静态 import：sharp 会加载 libvips 原生库，静态引入会让
 * 所有 import 本模块的路径（如前台壁纸路由链上的 wallpaperCache）在冷启动时一起付这笔开销。
 * 只有真的需要生成缩略图时才加载，之后由 Node 的模块缓存复用。
 */
async function loadSharp() {
  const mod = await import("sharp");
  return mod.default;
}

/**
 * 读取或生成缩略图。
 *
 * @param source 来源分区（uploads / wallpaper），同时是缓存子目录名
 * @param fileName 原文件名（调用方必须已完成安全校验）
 * @param width 目标宽度（调用方必须已按白名单校验）
 * @param loadSource 懒加载原图内容；仅在缓存未命中时调用
 * @returns WebP 字节；无法生成时返回 null，调用方回退原图
 */
export async function getOrCreateThumbnail(
  source: string,
  fileName: string,
  width: number,
  loadSource: () => Promise<Buffer | null>
): Promise<Buffer | null> {
  const target = thumbPath(source, fileName, width);

  // 命中缓存：连原图都不用读
  try {
    return await fs.readFile(target);
  } catch {
    /* 未命中，继续生成 */
  }

  const pending = inFlight.get(target);
  if (pending) return pending;

  const task = (async (): Promise<Buffer | null> => {
    try {
      const input = await loadSource();
      if (!input) return null;

      const sharp = await loadSharp();
      const out = await sharp(input, { failOn: "none" })
        // 手机拍摄的照片方向写在 EXIF 里，不转正会让缩略图躺着
        .rotate()
        // withoutEnlargement：原图比目标宽度还小时保持原尺寸，不做放大
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer();

      const dir = path.dirname(target);
      await fs.mkdir(dir, { recursive: true });
      const tmp = `${target}.tmp`;
      await fs.writeFile(tmp, out);
      try {
        await fs.rename(tmp, target);
      } catch {
        // 少数平台（如 Windows 上目标被外部句柄短暂占用）rename 会失败：退回直接覆盖写
        await fs.writeFile(target, out);
        await fs.rm(tmp, { force: true }).catch(() => {});
      }
      return out;
    } catch {
      // 格式不支持（ICO 等）或文件损坏：交给调用方回退原图
      return null;
    } finally {
      inFlight.delete(target);
    }
  })();

  inFlight.set(target, task);
  return task;
}

/** 删除某张图的全部尺寸缩略图（原文件被删时调用，避免缓存越攒越多） */
export async function removeThumbnails(source: string, fileName: string): Promise<void> {
  await Promise.all(
    THUMB_WIDTHS.map((width) =>
      fs.rm(thumbPath(source, fileName, width), { force: true }).catch(() => {
        /* 不存在即视为已清理 */
      })
    )
  );
}

/** 清空某个来源的全部缩略图（壁纸缓存整体清空时调用） */
export async function clearThumbnails(source: string): Promise<void> {
  await fs.rm(path.join(getThumbRoot(), source), { recursive: true, force: true }).catch(() => {
    /* 目录不存在即视为已清理 */
  });
}