import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearThumbnails,
  getOrCreateThumbnail,
  removeThumbnails,
} from "@/lib/thumbnails";

/**
 * 缩略图生成与磁盘缓存。
 *
 * 后台网格是原图直出，一页 24 张、缓存最多 300 张，同时解码会把主线程占满
 * （「图片还没加载完，页面先卡住」）。这里锁住四条关键契约：
 * 1. 命中缓存时**不读原图**（否则读 3MB 再丢掉，白费一次 IO 与内存分配）；
 * 2. 并发请求同一张只生成一次（避免重复跑 sharp）；
 * 3. 只缩不放（withoutEnlargement），不把小图放大成糊图；
 * 4. 生成失败返回 null（交给路由回退原图），而不是抛错让整片网格 500。
 */

let tmpRoot: string;

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "qiyun-thumb-"));
  process.env.QIYUN_THUMB_DIR = tmpRoot;
});

afterAll(async () => {
  delete process.env.QIYUN_THUMB_DIR;
  await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
});

/** 造一张纯色测试图（宽 x 高） */
async function makeImage(width: number, height: number): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  return sharp({
    create: { width, height, channels: 3, background: { r: 180, g: 120, b: 60 } },
  })
    .png()
    .toBuffer();
}

/** 读出图片实际尺寸 */
async function sizeOf(buffer: Buffer): Promise<{ width: number; height: number }> {
  const sharp = (await import("sharp")).default;
  const meta = await sharp(buffer).metadata();
  return { width: meta.width ?? 0, height: meta.height ?? 0 };
}

beforeEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
  await fs.mkdir(tmpRoot, { recursive: true });
});

describe("缩略图生成", () => {
  it("生成 WebP 缩略图，宽度收敛到请求值", async () => {
    const source = await makeImage(1200, 800);
    const load = vi.fn(async () => source);

    const thumb = await getOrCreateThumbnail("uploads", "a.png", 320, load);

    expect(thumb).not.toBeNull();
    // WebP 的 RIFF 容器头：'RIFF' .... 'WEBP'
    expect(thumb!.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(thumb!.subarray(8, 12).toString("ascii")).toBe("WEBP");
    expect((await sizeOf(thumb!)).width).toBe(320);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("命中缓存时不再读原图（懒加载）", async () => {
    const source = await makeImage(1000, 700);
    await getOrCreateThumbnail("uploads", "b.png", 320, async () => source);

    const load = vi.fn(async () => source);
    const second = await getOrCreateThumbnail("uploads", "b.png", 320, load);

    expect(second).not.toBeNull();
    expect(load, "命中缓存却仍读了原图，白费一次磁盘 IO").not.toHaveBeenCalled();
  });

  it("不同宽度各自缓存，互不覆盖", async () => {
    const source = await makeImage(1200, 900);
    const w320 = await getOrCreateThumbnail("uploads", "c.png", 320, async () => source);
    const w640 = await getOrCreateThumbnail("uploads", "c.png", 640, async () => source);

    expect((await sizeOf(w320!)).width).toBe(320);
    expect((await sizeOf(w640!)).width).toBe(640);
    // 两份缓存都要留在磁盘上：第二次调用不能把第一次的结果顶掉
    const files = await fs.readdir(path.join(tmpRoot, "uploads", "320"));
    expect(files).toEqual(["c.png.webp"]);
  });

  it("并发请求同一张只生成一次（避免重复跑 sharp）", async () => {
    const source = await makeImage(900, 600);
    let calls = 0;
    const load = async () => {
      calls += 1;
      // 加一点延迟，模拟真实的读盘耗时，让并发窗口真的重叠
      await new Promise((r) => setTimeout(r, 30));
      return source;
    };

    const [a, b] = await Promise.all([
      getOrCreateThumbnail("uploads", "d.png", 320, load),
      getOrCreateThumbnail("uploads", "d.png", 320, load),
    ]);

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(calls, "并发时重复生成了缩略图").toBe(1);
  });

  it("原图比目标宽度小的时候不放大（withoutEnlargement）", async () => {
    const source = await makeImage(200, 150);

    const thumb = await getOrCreateThumbnail("uploads", "small.png", 320, async () => source);

    // 放大只会得到一张更糊的图，体积还更大
    expect((await sizeOf(thumb!)).width).toBe(200);
  });

  it("原图不存在时返回 null，交给调用方回退", async () => {
    const thumb = await getOrCreateThumbnail("uploads", "missing.png", 320, async () => null);
    expect(thumb).toBeNull();
  });

  it("无法解码的内容返回 null，不抛错", async () => {
    const thumb = await getOrCreateThumbnail(
      "uploads",
      "broken.ico",
      320,
      async () => Buffer.from("not an image at all")
    );
    expect(thumb).toBeNull();
  });

  it("不残留 .tmp 临时文件（原子写的中间产物）", async () => {
    const source = await makeImage(600, 400);
    await getOrCreateThumbnail("uploads", "e.png", 320, async () => source);

    const files = await fs.readdir(path.join(tmpRoot, "uploads", "320"));
    expect(files.filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});

describe("缩略图清理", () => {
  it("removeThumbnails 清掉该图的全部尺寸", async () => {
    const source = await makeImage(1200, 800);
    await getOrCreateThumbnail("uploads", "f.png", 320, async () => source);
    await getOrCreateThumbnail("uploads", "f.png", 640, async () => source);

    await removeThumbnails("uploads", "f.png");

    const load = vi.fn(async () => source);
    await getOrCreateThumbnail("uploads", "f.png", 320, load);
    expect(load, "清理后应视为未命中，需要重新生成").toHaveBeenCalledTimes(1);
  });

  it("clearThumbnails 清空整个来源分区", async () => {
    const source = await makeImage(800, 600);
    await getOrCreateThumbnail("wallpaper", "g.jpg", 320, async () => source);

    await clearThumbnails("wallpaper");

    await expect(fs.readdir(path.join(tmpRoot, "wallpaper"))).rejects.toThrow();
  });

  it("清理不存在的目标不抛错（幂等）", async () => {
    await expect(removeThumbnails("uploads", "nope.png")).resolves.toBeUndefined();
    await expect(clearThumbnails("nonexistent")).resolves.toBeUndefined();
  });
});
