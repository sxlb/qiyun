import { describe, it, expect } from "vitest";
import { getImageSize, mimeFromExt } from "@/lib/uploads";

function png(width: number, height: number): Buffer {
  const buf = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8); // IHDR 长度
  buf.write("IHDR", 12); // 块类型
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function gif(width: number, height: number): Buffer {
  const buf = Buffer.alloc(10);
  buf.write("GIF89a", 0);
  buf.writeUInt16LE(width, 6);
  buf.writeUInt16LE(height, 8);
  return buf;
}

function jpeg(width: number, height: number): Buffer {
  const buf = Buffer.from([
    0xff, 0xd8, // SOI
    0xff, 0xc0, // SOF0
    0x00, 0x0b, // 段长度
    0x08, // 精度
  ]);
  const w = Buffer.alloc(4);
  w.writeUInt16BE(height, 0);
  w.writeUInt16BE(width, 2);
  return Buffer.concat([buf, w]);
}

// WebP 三个 fixture 均按 RIFF 规范构造：块头 8 字节（FourCC 12~15 + 块长度 16~19），
// 负载自偏移 20 起。此前 fixture 把负载写在 16 起，与实现的同一处错误互相印证，
// 导致「实现了也测得过」——修正实现后必须同步按规范重建 fixture。

function webpLossy(width: number, height: number): Buffer {
  const head = Buffer.alloc(26);
  head.write("RIFF", 0);
  head.writeUInt32LE(40, 4);
  head.write("WEBP", 8);
  head.write("VP8 ", 12);
  head.writeUInt32LE(10, 16); // 块长度
  // 负载：帧标签(20~22) + 起始码 9D 01 2A(23~25)，尺寸自 26 起
  head[23] = 0x9d;
  head[24] = 0x01;
  head[25] = 0x2a;
  const dim = Buffer.alloc(4);
  dim.writeUInt16LE(width & 0x3fff, 0);
  dim.writeUInt16LE(height & 0x3fff, 2);
  return Buffer.concat([head, dim]);
}

function webpLossless(width: number, height: number): Buffer {
  const head = Buffer.alloc(21);
  head.write("RIFF", 0);
  head.writeUInt32LE(30, 4);
  head.write("WEBP", 8);
  head.write("VP8L", 12);
  head.writeUInt32LE(5, 16); // 块长度
  head[20] = 0x2f; // 负载签名
  const packed = (width - 1) | ((height - 1) << 14);
  const val = Buffer.alloc(4);
  val.writeUInt32LE(packed, 0);
  return Buffer.concat([head, val]);
}

function webpExtended(width: number, height: number): Buffer {
  const buf = Buffer.alloc(30);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(20, 4);
  buf.write("WEBP", 8);
  buf.write("VP8X", 12);
  buf.writeUInt32LE(10, 16); // VP8X 块长度固定为 10
  buf[20] = 0x10; // 标志位：L(alpha) 置位
  buf.writeUIntLE(width - 1, 24, 3);
  buf.writeUIntLE(height - 1, 27, 3);
  return buf;
}

describe("getImageSize（图片尺寸解析）", () => {
  it("PNG 读取宽高", () => {
    expect(getImageSize(png(200, 100))).toEqual({ width: 200, height: 100 });
  });

  it("GIF 读取宽高", () => {
    expect(getImageSize(gif(300, 150))).toEqual({ width: 300, height: 150 });
  });

  it("JPEG 读取宽高", () => {
    expect(getImageSize(jpeg(160, 80))).toEqual({ width: 160, height: 80 });
  });

  it("WebP lossy 读取宽高", () => {
    expect(getImageSize(webpLossy(120, 60))).toEqual({ width: 120, height: 60 });
  });

  it("WebP lossless 读取宽高", () => {
    expect(getImageSize(webpLossless(120, 60))).toEqual({ width: 120, height: 60 });
  });

  it("WebP 扩展格式（VP8X，含 alpha/动画）读取画布宽高", () => {
    expect(getImageSize(webpExtended(400, 300))).toEqual({ width: 400, height: 300 });
  });

  it("标记前含 0xFF 填充字节的 JPEG 仍能读出尺寸", () => {
    const filled = Buffer.concat([
      Buffer.from([0xff, 0xd8]), // SOI
      Buffer.from([0xff, 0xff, 0xff]), // 允许的填充字节
      Buffer.from([0xff, 0xc0, 0x00, 0x0b, 0x08]), // SOF0 + 段长 + 精度
      Buffer.from([0x00, 0x40, 0x00, 0xa0]), // 高 64 / 宽 160
    ]);
    expect(getImageSize(filled)).toEqual({ width: 160, height: 64 });
  });

  it("截断的 ICO 不返回虚假的 256×256", () => {
    // 6 字节：保留字(2)+类型(2)+目录项数(2)，缺少目录项的宽高字节
    expect(getImageSize(Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00]))).toEqual({
      width: 0,
      height: 0,
    });
  });

  it("非图片 / 未知类型回退 0,0", () => {
    expect(getImageSize(Buffer.from("hello world, not an image"))).toEqual({ width: 0, height: 0 });
  });
});

describe("mimeFromExt", () => {
  it("常见扩展名映射正确", () => {
    expect(mimeFromExt(".png")).toBe("image/png");
    expect(mimeFromExt(".JPG")).toBe("image/jpeg");
    expect(mimeFromExt(".webp")).toBe("image/webp");
    expect(mimeFromExt(".svg")).toBe("image/svg+xml");
  });

  it("未知扩展名回退 image/png", () => {
    expect(mimeFromExt(".xyz")).toBe("image/png");
  });
});