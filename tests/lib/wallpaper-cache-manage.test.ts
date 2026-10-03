import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * 壁纸缓存的管理能力（后台「媒体库 → 壁纸缓存」分区）。
 *
 * 这些缓存不登记 ImageAsset：它会被自动裁剪（上限 100 张），生命周期与媒体库里的用户内容
 * 不同 —— 登记进库迟早留下「记录还在、文件已被删」的死链接。因此这里锁住三件事：
 * 1. 列表以磁盘为准（大小取文件、stat 失败标记为已丢失），而不是照抄 manifest；
 * 2. 删除时先改清单再删文件（清单是索引，不能出现「有记录没文件」）；
 * 3. 清空时把刷新时间戳一并归零，否则用户点完清空会看到首页长时间没有背景。
 */

const fsMock = vi.hoisted(() => ({
  mkdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
  rm: vi.fn(),
  access: vi.fn(),
}));

vi.mock("node:fs", () => ({ promises: fsMock }));

const { listCachedWallpapers, deleteCachedWallpaper, clearWallpaperCache } = await import(
  "@/lib/wallpaperCache"
);

/** 让 manifest 读取返回给定条目 */
function manifestWith(
  entries: Array<{ fileName: string; addedAt?: number; size?: number; tag?: string }>
): void {
  fsMock.readFile.mockResolvedValue(
    JSON.stringify({
      entries: entries.map((e, i) => ({
        sourceUrl: `https://example.com/${i}.jpg`,
        addedAt: 100 + i,
        size: 1,
        ...e,
      })),
      lastRefreshAt: 1_700_000_000_000,
      lastDownloadAt: 1_700_000_000_000,
    })
  );
}

/** manifest 文件内容原样写坏（用于模拟外部工具改坏 / 合法 JSON 但条目非法） */
function manifestRaw(raw: string): void {
  fsMock.readFile.mockResolvedValue(raw);
}

/** stat 桩：按文件名决定存在性与大小 */
function stubDisk(map: Record<string, number>): void {
  fsMock.stat.mockImplementation((p: unknown) => {
    const name = String(p).split(/[\\/]/).pop() || "";
    const size = map[name];
    return size === undefined
      ? Promise.reject(new Error("ENOENT"))
      : Promise.resolve({ size } as never);
  });
}

/** 取最近一次写入的 manifest 内容 */
function lastWrittenManifest(): {
  entries: Array<{ fileName: string }>;
  lastRefreshAt: number | null;
  lastDownloadAt: number | null;
} {
  const call = fsMock.writeFile.mock.calls.at(-1);
  return JSON.parse(String(call?.[1]));
}

describe("listCachedWallpapers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMock.mkdir.mockResolvedValue(undefined as never);
    fsMock.rename.mockResolvedValue(undefined as never);
    manifestWith([]);
  });

  it("以磁盘实际状态为准：大小取文件、stat 失败标记为已丢失，bytes 只算存在的", async () => {
    manifestWith([
      { fileName: "old.jpg", addedAt: 100, size: 1 },
      { fileName: "new.jpg", addedAt: 200, size: 1 },
      { fileName: "gone.jpg", addedAt: 300, size: 999 },
    ]);
    stubDisk({ "old.jpg": 1024, "new.jpg": 2048 });

    const r = await listCachedWallpapers();

    expect(r.total).toBe(3);
    // 新到旧
    expect(r.items.map((i) => i.fileName)).toEqual(["gone.jpg", "new.jpg", "old.jpg"]);
    // 大小取磁盘上的真实值，而不是 manifest 里那个（可能是旧值）
    expect(r.items.find((i) => i.fileName === "new.jpg")!.size).toBe(2048);
    // 文件已不在 → 明确标记，界面据此提示「文件已不在磁盘上」
    expect(r.items.find((i) => i.fileName === "gone.jpg")!.exists).toBe(false);
    // 占用只统计真实存在的文件
    expect(r.bytes).toBe(1024 + 2048);
    expect(r.max).toBe(100);
    expect(r.items[0].url).toBe("/api/wallpaper/file/gone.jpg");
  });

  it("文件名不安全时不落到文件系统上探测", async () => {
    manifestWith([{ fileName: "../secret.jpg" }]);

    const r = await listCachedWallpapers();

    expect(fsMock.stat).not.toHaveBeenCalled();
    expect(r.items[0].exists).toBe(false);
  });

  it("缓存为空时返回空清单", async () => {
    manifestWith([]);
    const r = await listCachedWallpapers();
    expect(r).toMatchObject({ total: 0, bytes: 0 });
  });
});

describe("deleteCachedWallpaper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMock.mkdir.mockResolvedValue(undefined as never);
    fsMock.writeFile.mockResolvedValue(undefined as never);
    fsMock.rename.mockResolvedValue(undefined as never);
    fsMock.rm.mockResolvedValue(undefined as never);
  });

  it("命中时先写清单（剔除该条）再删文件", async () => {
    manifestWith([{ fileName: "a.jpg" }, { fileName: "b.jpg" }]);

    expect(await deleteCachedWallpaper("a.jpg")).toBe(true);

    // 清单里已不含 a.jpg
    expect(lastWrittenManifest().entries.map((e) => e.fileName)).toEqual(["b.jpg"]);
    // 文件也删了
    expect(fsMock.rm).toHaveBeenCalledTimes(1);
    expect(String(fsMock.rm.mock.calls[0][0])).toContain("a.jpg");
  });

  it("未命中时返回 false，且不写清单也不删文件", async () => {
    manifestWith([{ fileName: "a.jpg" }]);

    expect(await deleteCachedWallpaper("不存在.jpg")).toBe(false);

    expect(fsMock.writeFile).not.toHaveBeenCalled();
    expect(fsMock.rm).not.toHaveBeenCalled();
  });

  it("拒绝不安全文件名，且完全不触碰文件系统", async () => {
    manifestWith([{ fileName: "a.jpg" }]);

    expect(await deleteCachedWallpaper("../etc/passwd")).toBe(false);
    expect(await deleteCachedWallpaper("a/../../b")).toBe(false);

    expect(fsMock.writeFile).not.toHaveBeenCalled();
    expect(fsMock.rm).not.toHaveBeenCalled();
  });

  it("文件已不在磁盘上时仍能把清单里的残留记录清掉", async () => {
    manifestWith([{ fileName: "gone.jpg" }]);
    fsMock.rm.mockRejectedValueOnce(new Error("ENOENT"));

    expect(await deleteCachedWallpaper("gone.jpg")).toBe(true);
    expect(lastWrittenManifest().entries).toEqual([]);
  });
});

describe("clearWallpaperCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMock.mkdir.mockResolvedValue(undefined as never);
    fsMock.writeFile.mockResolvedValue(undefined as never);
    fsMock.rename.mockResolvedValue(undefined as never);
    fsMock.rm.mockResolvedValue(undefined as never);
    fsMock.readdir.mockResolvedValue([]);
  });

  it("删除全部文件、清单清空，并把刷新时间戳归零", async () => {
    manifestWith([{ fileName: "a.jpg" }, { fileName: "b.jpg" }]);
    fsMock.readdir.mockResolvedValue(["a.jpg", "b.jpg", "manifest.json"] as never);

    expect(await clearWallpaperCache()).toBe(2);

    expect(fsMock.rm).toHaveBeenCalledTimes(2);
    const written = lastWrittenManifest();
    expect(written.entries).toEqual([]);
    // 归零后下次访问会重新预取一张，不会出现「清空后首页长时间没有背景」
    expect(written.lastRefreshAt).toBeNull();
    expect(written.lastDownloadAt).toBeNull();
  });

  it("本来就没有缓存时返回 0，不删任何文件", async () => {
    manifestWith([]);
    expect(await clearWallpaperCache()).toBe(0);
    expect(fsMock.rm).not.toHaveBeenCalled();
  });

  it("以目录为准：清单被写坏成空时，磁盘上的孤儿文件仍会被清掉", async () => {
    // 清单里一条记录都没有，但目录里确实躺着两张图
    manifestWith([]);
    fsMock.readdir.mockResolvedValue(["orphan1.jpg", "orphan2.png", "manifest.json"] as never);

    expect(await clearWallpaperCache()).toBe(2);
    expect(fsMock.rm).toHaveBeenCalledTimes(2);
  });

  it("绝不删除 manifest.json 自身（清空后清单仍可正常写入）", async () => {
    manifestWith([]);
    fsMock.readdir.mockResolvedValue(["a.jpg", "manifest.json"] as never);

    await clearWallpaperCache();

    const removedPaths = fsMock.rm.mock.calls.map((c) => String(c[0]));
    expect(removedPaths.some((p) => p.includes("manifest.json"))).toBe(false);
  });

  it("跳过文件名不安全的目录项，不做越界删除", async () => {
    manifestWith([]);
    fsMock.readdir.mockResolvedValue(["ok.jpg", "../evil.jpg"] as never);

    expect(await clearWallpaperCache()).toBe(1);
    expect(String(fsMock.rm.mock.calls[0][0])).toContain("ok.jpg");
  });

  it("先删文件、后写空清单（中途失败也不会先把索引丢掉）", async () => {
    manifestWith([{ fileName: "a.jpg" }]);
    fsMock.readdir.mockResolvedValue(["a.jpg"] as never);
    fsMock.rm.mockRejectedValue(new Error("EBUSY"));

    // rm 失败被 catch 吞掉，仍然走到写清单
    await expect(clearWallpaperCache()).resolves.toBe(1);
    expect(lastWrittenManifest().entries).toEqual([]);
  });
});

/**
 * manifest 是磁盘上的普通 JSON 文件，可能被人工编辑或被外部清理工具改坏。
 * 这里锁住两件事：非法条目不能让管理接口崩成 500；写清单要原子替换。
 */
describe("manifest 健壮性", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMock.mkdir.mockResolvedValue(undefined as never);
    fsMock.writeFile.mockResolvedValue(undefined as never);
    fsMock.rename.mockResolvedValue(undefined as never);
    fsMock.rm.mockResolvedValue(undefined as never);
    fsMock.readdir.mockResolvedValue([]);
  });

  it("合法 JSON 但含非法条目时不抛错，非法条目被丢弃", async () => {
    manifestRaw(JSON.stringify({ entries: [null, "x", 42, { size: 1 }, { fileName: "ok.jpg" }] }));
    stubDisk({ "ok.jpg": 512 });

    const r = await listCachedWallpapers();

    expect(r.items.map((i) => i.fileName)).toEqual(["ok.jpg"]);
    expect(r.items[0].size).toBe(512);
  });

  it("条目字段缺失/类型不对时补默认值，而不是带着 undefined 往下传", async () => {
    manifestRaw(JSON.stringify({ entries: [{ fileName: "ok.jpg" }] }));
    stubDisk({ "ok.jpg": 10 });

    const r = await listCachedWallpapers();

    expect(r.items[0]).toMatchObject({ sourceUrl: "", addedAt: 0, tag: null, exists: true });
  });

  it("删除操作在 manifest 含非法条目时不会 500", async () => {
    manifestRaw(JSON.stringify({ entries: [null, { fileName: "a.jpg" }] }));

    expect(await deleteCachedWallpaper("a.jpg")).toBe(true);
    expect(lastWrittenManifest().entries.map((e) => e.fileName)).toEqual([]);
  });

  it("非法 JSON 时按空清单处理，静默不抛错", async () => {
    manifestRaw("{ 这不是 JSON");
    expect((await listCachedWallpapers()).total).toBe(0);
  });

  it("写清单走「临时文件 + rename」原子替换，避免被读到半截 JSON", async () => {
    manifestWith([{ fileName: "a.jpg" }]);

    await deleteCachedWallpaper("a.jpg");

    expect(String(fsMock.writeFile.mock.calls[0][0])).toContain("manifest.json.tmp");
    expect(fsMock.rename).toHaveBeenCalledTimes(1);
    const [from, to] = fsMock.rename.mock.calls[0];
    expect(String(from)).toContain("manifest.json.tmp");
    expect(String(to)).toContain("manifest.json");
  });

  it("rename 失败（如 Windows 上目标被短暂占用）时退回直接覆盖写，不丢这次更新", async () => {
    manifestWith([{ fileName: "a.jpg" }]);
    fsMock.rename.mockRejectedValue(new Error("EPERM"));

    expect(await deleteCachedWallpaper("a.jpg")).toBe(true);

    const last = fsMock.writeFile.mock.calls.at(-1);
    expect(String(last?.[0])).toContain("manifest.json");
    expect(JSON.parse(String(last?.[1])).entries).toEqual([]);
  });
});
