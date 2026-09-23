import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * 上传与媒体库工具集（合并自原 uploads.ts + media.ts）：
 * - 上传/读取：文件头嗅探、路径穿越防御、MIME 映射
 * - 媒体库：图片尺寸解析（png/gif/bmp/webp/jpeg/ico）
 * MIME 映射共用同一份表，避免两处维护不一致。
 */

/** 上传文件目录（Docker 卷映射，与 wallpapers 并列） */
export function getUploadsDir(): string {
  return path.join(process.cwd(), "data", "uploads");
}

/** 单文件上限：10MB */
export const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;

/**
 * 按文件头（Magic Number）识别图片类型。
 * 支持 jpg/png/webp/gif/avif/bmp/ico；SVG 及未知二进制返回 null。
 */
export function detectImageExt(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return ".jpg";
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) return ".png";
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).equals(Buffer.from("RIFF")) &&
    buffer.subarray(8, 12).equals(Buffer.from("WEBP"))
  ) return ".webp";
  if (buffer.length >= 6 && buffer.subarray(0, 4).equals(Buffer.from("GIF8"))) return ".gif";
  if (
    buffer.length >= 12 &&
    buffer.subarray(4, 8).equals(Buffer.from("ftyp")) &&
    (buffer.subarray(8, 12).equals(Buffer.from("avif")) ||
      buffer.subarray(8, 12).equals(Buffer.from("avis")))
  ) return ".avif";
  if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) return ".bmp";
  // ICO：00 00 01 00（保留字 + 类型 1 = 图标）
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x00 &&
    buffer[1] === 0x00 &&
    buffer[2] === 0x01 &&
    buffer[3] === 0x00
  ) return ".ico";
  return null;
}

/** 文件名安全校验：白名单字符 + 禁止目录穿越 */
export function isSafeFileName(fileName: string): boolean {
  if (!/^[0-9a-zA-Z_.-]+$/.test(fileName)) return false;
  if (fileName === "." || fileName === ".." || fileName.includes("..")) return false;
  return true;
}

/** 扩展名 → MIME 映射（文件响应与媒体库展示共用同一份，避免两处维护） */
const EXT_MIME_MAP: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};

/** 扩展名 → MIME（供媒体库展示使用；未知类型回退 image/png，保证 <img> 可解码） */
export function mimeFromExt(ext: string): string {
  return EXT_MIME_MAP[ext.toLowerCase()] || "image/png";
}

/** 扩展名 → Content-Type（供文件响应使用；未知类型回退 octet-stream） */
function contentTypeFromExt(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  return EXT_MIME_MAP[ext] || "application/octet-stream";
}

/** 生成唯一安全的文件名 */
// 【High 修复】使用 randomUUID()（122-bit 随机熵）替代 Date.now()-randomBytes(6)，避免同毫秒并发上传文件名碰撞
function newFileName(ext: string): string {
  return `${randomUUID()}${ext}`;
}

/**
 * 保存上传文件：写入 uploads 目录并返回相对 URL（如 /api/uploads/file/xxx.png）。
 * 校验失败（类型不支持/为空/超限）抛错。
 */
export async function saveUpload(buffer: Buffer): Promise<string> {
  if (buffer.byteLength === 0) throw new Error("文件内容为空");
  if (buffer.byteLength > MAX_UPLOAD_SIZE) throw new Error("文件超过 10MB 限制");
  const ext = detectImageExt(buffer);
  if (!ext) throw new Error("不支持的图片类型（仅支持 jpg/png/webp/gif/avif/bmp/ico）");

  const fileName = newFileName(ext);
  const dir = getUploadsDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, fileName), buffer);
  return `/api/uploads/file/${fileName}`;
}

/**
 * 读取上传文件。文件名不合法 / 不存在返回 null。
 */
export async function readUpload(
  fileName: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (!isSafeFileName(fileName)) return null;
  const dir = getUploadsDir();
  const filePath = path.join(dir, fileName);
  if (!filePath.startsWith(dir + path.sep)) return null;
  try {
    const buffer = await fs.readFile(filePath);
    return { buffer, contentType: contentTypeFromExt(fileName) };
  } catch {
    return null;
  }
}

// ===== 以下导出来自 media.ts（已合并）：图片尺寸解析 =====

/** 读取原始图片尺寸（仅头部几十字节即可解析；解析失败返回 0,0） */
export function getImageSize(buffer: Buffer): { width: number; height: number } {
  const ext = detectImageExt(buffer);
  if (!ext) return { width: 0, height: 0 };

  try {
    if (ext === ".png") {
      // PNG: 8 字节签名 + IHDR (宽高为第 4 字节起的大端 uint32)
      if (buffer.length >= 24) {
        return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
      }
    } else if (ext === ".gif") {
      // GIF: 第 6/7 字节为宽，8/9 为高（小端 uint16）
      if (buffer.length >= 10) {
        return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
      }
    } else if (ext === ".bmp") {
      // BMP: DIB 头第 4/8 字节为宽高（小端 int32）
      if (buffer.length >= 26) {
        return { width: buffer.readInt32LE(18), height: Math.abs(buffer.readInt32LE(22)) };
      }
    } else if (ext === ".webp") {
      return webpSize(buffer);
    } else if (ext === ".jpg" || ext === ".jpeg") {
      return jpegSize(buffer);
    } else if (ext === ".ico") {
      return icoSize(buffer);
    }
  } catch {
    // 忽略解析异常，回退 0,0
  }
  return { width: 0, height: 0 };
}

/**
 * WebP 尺寸：VP8 / VP8L / VP8X 三种头布局不同。
 * RIFF 块头固定 8 字节：FourCC(12~15) + 块长度(16~19)，**负载自偏移 20 起**
 * （此前按「负载自 16 起」读取，导致三种分支全部读错字节、尺寸入库即错）。
 */
function webpSize(buffer: Buffer): { width: number; height: number } {
  if (buffer.length < 20) return { width: 0, height: 0 };
  const type = buffer.toString("ascii", 12, 16);
  if (type === "VP8X") {
    // 扩展格式（含 alpha/动画）：负载 = 标志(1) + 保留(3) + 宽-1(24bit LE) + 高-1(24bit LE)
    if (buffer.length < 30) return { width: 0, height: 0 };
    return { width: buffer.readUIntLE(24, 3) + 1, height: buffer.readUIntLE(27, 3) + 1 };
  }
  if (type === "VP8 ") {
    // 有损：负载 = 帧标签(3) + 起始码 9D 01 2A(3) + 宽(16bit LE) + 高(16bit LE)
    if (buffer.length < 30) return { width: 0, height: 0 };
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  if (type === "VP8L") {
    // 无损：负载 = 签名 0x2F(1) + 打包值(32bit LE)：bit0-13 宽-1、bit14-27 高-1
    if (buffer.length < 25) return { width: 0, height: 0 };
    const b = buffer.readUInt32LE(21);
    return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
  }
  return { width: 0, height: 0 };
}

/** JPEG 尺寸：遍历 SOF 标记（FFC0-FFC3, FFC5-FFC7, FFC9-FFCB, FFCD-FFCF） */
function jpegSize(buffer: Buffer): { width: number; height: number } {
  let i = 2; // 跳过 SOI (FFD8)
  while (i + 8 < buffer.length) {
    if (buffer[i] !== 0xff) {
      i += 1;
      continue;
    }
    // 标记前允许出现任意数量 0xFF 填充字节（JPEG 规范 B.1.1.2）。
    // 不跳过会把填充字节当成「带长度字段的标记」，长度读成垃圾值后 i 直接越界 → 恒返回 0,0。
    while (i + 1 < buffer.length && buffer[i + 1] === 0xff) i += 1;
    const marker = buffer[i + 1];
    // 独立标记跳过
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const isSOF =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    const len = buffer.readUInt16BE(i + 2);
    if (isSOF && len >= 7) {
      return { height: buffer.readUInt16BE(i + 5), width: buffer.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return { width: 0, height: 0 };
}

/** ICO 尺寸：目录头第 2/3 字节为宽/高（0 表示 256） */
function icoSize(buffer: Buffer): { width: number; height: number } {
  // 需要读到下标 6/7，故至少 8 字节；不足时返回 0,0 —— 否则 undefined || 256 会把
  // 截断文件上报成 256×256 的虚假尺寸。
  if (buffer.length < 8) return { width: 0, height: 0 };
  const w = buffer[0x06] || 256;
  const h = buffer[0x07] || 256;
  return { width: w, height: h };
}
