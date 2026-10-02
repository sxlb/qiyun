import { describe, it, expect } from "vitest";
import { detectImageExt, isSafeFileName, MAX_UPLOAD_SIZE } from "@/lib/uploads";

describe("detectImageExt（magic number 类型识别）", () => {
  it("识别 PNG", () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(detectImageExt(buf)).toBe(".png");
  });

  it("识别 JPEG", () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    expect(detectImageExt(buf)).toBe(".jpg");
  });

  it("识别 ICO", () => {
    const buf = Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00]);
    expect(detectImageExt(buf)).toBe(".ico");
  });

  it("SVG 文本被拒绝（返回 null）", () => {
    const buf = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>");
    expect(detectImageExt(buf)).toBeNull();
  });

  it("未知二进制被拒绝", () => {
    const buf = Buffer.from("not-an-image");
    expect(detectImageExt(buf)).toBeNull();
  });
});

describe("isSafeFileName（防路径穿越）", () => {
  it("合法文件名通过", () => {
    expect(isSafeFileName("123456-abcdef.png")).toBe(true);
  });

  it("目录穿越被拒绝", () => {
    expect(isSafeFileName("../etc/passwd")).toBe(false);
    expect(isSafeFileName("..")).toBe(false);
  });

  it("非法字符被拒绝", () => {
    expect(isSafeFileName("a/b.png")).toBe(false);
    expect(isSafeFileName("a\\b.png")).toBe(false);
  });
});

describe("MAX_UPLOAD_SIZE", () => {
  it("上限为 10MB", () => {
    expect(MAX_UPLOAD_SIZE).toBe(10 * 1024 * 1024);
  });
});
