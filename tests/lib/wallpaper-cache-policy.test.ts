import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import dns from "node:dns";

/**
 * 壁纸缓存的容量与填充策略。
 *
 * 三件事必须锁住，它们直接决定磁盘占用与上游压力：
 * 1. 额度按「预算组」分 —— 电脑 100 / 手机 100 / 必应共享 100，互不挤占；
 * 2. 填满即**停止自动新增**，不再删旧图（旧图被自动删掉会让访客刚看惯的壁纸凭空消失）；
 * 3. 只有「手动换一张」才会在满额时替换最旧的一张 —— 否则满仓之后就没有换新的出口了。
 */

const fsMock = vi.hoisted(() => ({
  mkdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
  rm: vi.fn(),
}));

vi.mock("node:fs", () => ({ promises: fsMock }));

const {
  cacheBudgetFor,
  replaceWallpaper,
  downloadAndCacheWallpaper,
  maybePrefetchWallpaper,
  listCachedWallpapers,
  MAX_BUDGET_SIZE,
  READY_CACHE_SIZE,
} = await import("@/lib/wallpaperCache");

const SRC = "https://cdn.example.com/a.jpg";
/** 合法 JPEG 头部（下载链路会校验 magic number） */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

interface Entry {
  fileName: string;
  addedAt: number;
  size: number;
  tag?: string;
}

/** 造一份已有 n 条指定标签条目的 manifest */
function manifestWith(n: number, tag: string, extra: Record<string, unknown> = {}): void {
  const entries: Entry[] = Array.from({ length: n }, (_, i) => ({
    fileName: `f${i}.jpg`,
    addedAt: 1000 + i,
    size: 10,
    tag,
  }));
  fsMock.readFile.mockResolvedValue(
    JSON.stringify({
      entries: entries.map((e) => ({
        sourceUrl: "https://example.com/x.jpg",
        ...e,
      })),
      lastRefreshAt: null,
      lastDownloadAt: null,
      ...extra,
    })
  );
}

/** 取最近一次写入的 manifest */
function lastWrittenManifest(): { entries: Entry[] } {
  const call = fsMock.writeFile.mock.calls.at(-1);
  return JSON.parse(String(call?.[1]));
}

/** 实际落盘的图片文件路径（排除 manifest 自身与其临时文件） */
function writtenImagePaths(): string[] {
  return fsMock.writeFile.mock.calls
    .map((c) => String(c[0]))
    .filter((p) => !p.includes("manifest.json"));
}

beforeEach(() => {
  vi.clearAllMocks();
  fsMock.mkdir.mockResolvedValue(undefined as never);
  fsMock.writeFile.mockResolvedValue(undefined as never);
  fsMock.rename.mockResolvedValue(undefined as never);
  fsMock.readdir.mockResolvedValue([] as never);
  fsMock.rm.mockResolvedValue(undefined as never);
  fsMock.stat.mockResolvedValue({ size: 10 } as never);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JPEG, { status: 200, headers: { "content-type": "image/jpeg" } }))
  );
  vi.spyOn(dns.promises, "lookup").mockResolvedValue([
    { address: "93.184.216.34", family: 4 },
  ] as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cacheBudgetFor（分池标签 → 预算组）", () => {
  it("风景 / 动漫按设备归入电脑或手机", () => {
    expect(cacheBudgetFor("landscape:pc")).toBe("pc");
    expect(cacheBudgetFor("anime:pc")).toBe("pc");
    expect(cacheBudgetFor("landscape:mobile")).toBe("mobile");
    expect(cacheBudgetFor("anime:mobile")).toBe("mobile");
  });

  it("必应这类与设备无关的源归入共享组；升级前没有标签的历史条目也算共享", () => {
    expect(cacheBudgetFor("shared")).toBe("shared");
    expect(cacheBudgetFor(null)).toBe("shared");
    expect(cacheBudgetFor(undefined)).toBe("shared");
  });
});

describe("额度：填满即停止自动新增", () => {
  it("未满时正常新增", async () => {
    manifestWith(MAX_BUDGET_SIZE - 1, "anime:pc");

    const fileName = await downloadAndCacheWallpaper(SRC, "anime:pc");

    expect(fileName).toMatch(/\.jpg$/);
    expect(writtenImagePaths()).toHaveLength(1);
    expect(lastWrittenManifest().entries).toHaveLength(MAX_BUDGET_SIZE);
  });

  it("已满时直接跳过：不请求上游、不落盘、也不删任何旧图", async () => {
    manifestWith(MAX_BUDGET_SIZE, "anime:pc");

    expect(await downloadAndCacheWallpaper(SRC, "anime:pc")).toBeNull();

    expect(fetch).not.toHaveBeenCalled();
    expect(writtenImagePaths()).toHaveLength(0);
    // 关键：不再像旧实现那样「超出上限就删最旧」
    expect(fsMock.rm).not.toHaveBeenCalled();
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it("额度互不挤占：电脑满了，手机照样能新增", async () => {
    manifestWith(MAX_BUDGET_SIZE, "landscape:pc");

    const fileName = await downloadAndCacheWallpaper(SRC, "landscape:mobile");

    expect(fileName).toMatch(/\.jpg$/);
    const written = lastWrittenManifest().entries;
    expect(written.filter((e) => e.tag === "landscape:pc")).toHaveLength(MAX_BUDGET_SIZE);
    expect(written.filter((e) => e.tag === "landscape:mobile")).toHaveLength(1);
  });

  it("同一设备下的不同源共用一份额度：风景:pc 已满时动漫:pc 也不再加", async () => {
    manifestWith(MAX_BUDGET_SIZE, "landscape:pc");

    expect(await downloadAndCacheWallpaper(SRC, "anime:pc")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("手动换图：满额时替换最旧的一张", () => {
  it("满额下仍能换图，总数不变且挤掉的是本组最旧的那张", async () => {
    manifestWith(MAX_BUDGET_SIZE, "anime:pc");
    const oldestName = "f0.jpg"; // addedAt 最小

    const fileName = await replaceWallpaper(SRC, "anime:pc");

    expect(fileName).toMatch(/\.jpg$/);
    const entries = lastWrittenManifest().entries;
    expect(entries).toHaveLength(MAX_BUDGET_SIZE);
    expect(entries.map((e) => e.fileName)).not.toContain(oldestName);
    // 被挤掉的那张文件也要删掉，否则留下孤儿
    expect(fsMock.rm.mock.calls.map((c) => String(c[0])).join(",")).toContain(oldestName);
  });

  it("不会误删其它预算组的图（手机满额换图不动电脑）", async () => {
    // 这张电脑端的图 addedAt 比所有手机图都早：若实现成「删全局最旧」就会误删它
    const entries = [
      { fileName: "pc-keep.jpg", sourceUrl: "", addedAt: 1, size: 10, tag: "landscape:pc" },
      ...Array.from({ length: MAX_BUDGET_SIZE }, (_, i) => ({
        fileName: `m${i}.jpg`,
        sourceUrl: "",
        addedAt: 1000 + i,
        size: 10,
        tag: "landscape:mobile",
      })),
    ];
    fsMock.readFile.mockResolvedValue(
      JSON.stringify({ entries, lastRefreshAt: null, lastDownloadAt: null })
    );

    await replaceWallpaper(SRC, "landscape:mobile");

    const written = lastWrittenManifest().entries;
    expect(written.map((e) => e.fileName)).toContain("pc-keep.jpg");
    expect(written.filter((e) => e.tag === "landscape:mobile")).toHaveLength(MAX_BUDGET_SIZE);
  });

  it("未满时就是普通新增，不删任何东西", async () => {
    manifestWith(3, "anime:pc");

    await replaceWallpaper(SRC, "anime:pc");

    expect(fsMock.rm).not.toHaveBeenCalled();
    expect(lastWrittenManifest().entries).toHaveLength(4);
  });
});

describe("自动填充的节奏", () => {
  it("不足「够用」阈值时不受刷新间隔约束（否则间隔 0 时永远只有 1 张图）", async () => {
    manifestWith(1, "anime:pc");

    await maybePrefetchWallpaper(SRC, 0, "anime:pc");

    expect(writtenImagePaths()).toHaveLength(1);
  });

  it("已达到「够用」阈值且间隔为 0：不再补图", async () => {
    manifestWith(READY_CACHE_SIZE, "anime:pc");

    await maybePrefetchWallpaper(SRC, 0, "anime:pc");

    expect(writtenImagePaths()).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("达到阈值后按间隔补：未到期不补，到期才补 1 张", async () => {
    const now = Date.now();
    manifestWith(READY_CACHE_SIZE, "anime:pc", { lastRefreshAt: now });

    await maybePrefetchWallpaper(SRC, 5, "anime:pc");
    expect(writtenImagePaths()).toHaveLength(0);

    manifestWith(READY_CACHE_SIZE, "anime:pc", { lastRefreshAt: now - 6 * 60_000 });
    await maybePrefetchWallpaper(SRC, 5, "anime:pc");
    expect(writtenImagePaths()).toHaveLength(1);
  });

  it("已满额度时连热身都不做（到一百就停止）", async () => {
    manifestWith(MAX_BUDGET_SIZE, "anime:pc");

    await maybePrefetchWallpaper(SRC, 5, "anime:pc");

    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("后台列表按预算组拆分", () => {
  it("给出各组的张数、占用与上限，并带上「够用」阈值", async () => {
    fsMock.readFile.mockResolvedValue(
      JSON.stringify({
        entries: [
          { fileName: "a.jpg", sourceUrl: "", addedAt: 1, size: 100, tag: "anime:pc" },
          { fileName: "b.jpg", sourceUrl: "", addedAt: 2, size: 200, tag: "landscape:pc" },
          { fileName: "c.jpg", sourceUrl: "", addedAt: 3, size: 400, tag: "anime:mobile" },
          { fileName: "d.jpg", sourceUrl: "", addedAt: 4, size: 800, tag: "shared" },
        ],
        lastRefreshAt: null,
        lastDownloadAt: null,
      })
    );
    fsMock.stat.mockImplementation(((p: unknown) => {
      const name = String(p).split(/[\\/]/).pop() || "";
      const sizes: Record<string, number> = { "a.jpg": 100, "b.jpg": 200, "c.jpg": 400, "d.jpg": 800 };
      return sizes[name] === undefined
        ? Promise.reject(new Error("ENOENT"))
        : Promise.resolve({ size: sizes[name] } as never);
    }) as never);

    const overview = await listCachedWallpapers();

    expect(overview.max).toBe(MAX_BUDGET_SIZE);
    expect(overview.readyThreshold).toBe(READY_CACHE_SIZE);
    expect(overview.budgets.map((b) => [b.key, b.count, b.bytes])).toEqual([
      ["pc", 2, 300],
      ["mobile", 1, 400],
      ["shared", 1, 800],
    ]);
    expect(overview.budgets.map((b) => b.label)).toEqual(["电脑", "手机", "必应共享"]);
  });
});
