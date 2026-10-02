import { describe, it, expect, vi, afterEach } from "vitest";
import { parseLrc, findLyricIndex, resolveLyricText, centeredScrollTop } from "@/components/useAudioPlayer";

/**
 * 顶部歌词显示所需的三块纯逻辑。
 *
 * 背景：歌词的拉取/解析/当前句跟踪原先都写在音乐弹窗内部的 Lyrics 组件里，
 * 而弹窗是按需挂载的 —— 顶部要常驻显示歌词，就必须把这三块提到常驻层
 * （useAudioPlayer），因此先把它们作为可单测的单元固定下来。
 */

describe("parseLrc（LRC 文本 → 行数组）", () => {
  it("解析标准时间标签", () => {
    const lines = parseLrc("[00:12.34]第一句\n[00:20.00]第二句");
    expect(lines).toEqual([
      { time: 12.34, text: "第一句" },
      { time: 20, text: "第二句" },
    ]);
  });

  it("一行多个时间标签展开为多行", () => {
    const lines = parseLrc("[00:01.00][00:05.50]重复的一句");
    expect(lines).toEqual([
      { time: 1, text: "重复的一句" },
      { time: 5.5, text: "重复的一句" },
    ]);
  });

  it("空文本行用 ♪ 占位", () => {
    expect(parseLrc("[00:03.00]")).toEqual([{ time: 3, text: "♪" }]);
  });

  it("乱序输入按时间升序输出", () => {
    const lines = parseLrc("[00:30.00]后\n[00:10.00]前");
    expect(lines.map((l) => l.text)).toEqual(["前", "后"]);
  });

  it("支持单数字的分钟/秒，以及无毫秒的标签", () => {
    expect(parseLrc("[1:2]短写法")).toEqual([{ time: 62, text: "短写法" }]);
  });

  it("没有时间标签时返回空数组", () => {
    expect(parseLrc("这是一段没有时间标签的文本")).toEqual([]);
    expect(parseLrc("")).toEqual([]);
  });
});

describe("findLyricIndex（按播放时间定位当前句）", () => {
  const lines = [
    { time: 10, text: "A" },
    { time: 20, text: "B" },
    { time: 30, text: "C" },
  ];

  it("没到第一句时为 -1", () => {
    expect(findLyricIndex(lines, 0)).toBe(-1);
    expect(findLyricIndex(lines, 9.99)).toBe(-1);
  });

  it("恰好到某句时命中该句", () => {
    expect(findLyricIndex(lines, 10)).toBe(0);
    expect(findLyricIndex(lines, 20)).toBe(1);
  });

  it("落在两句之间时命中前一句", () => {
    expect(findLyricIndex(lines, 19.9)).toBe(0);
    expect(findLyricIndex(lines, 25)).toBe(1);
  });

  it("超过最后一句时命中最后一句", () => {
    expect(findLyricIndex(lines, 999)).toBe(2);
  });

  it("空数组返回 -1", () => {
    expect(findLyricIndex([], 5)).toBe(-1);
  });
});

describe("resolveLyricText（歌词来源解析）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("非 URL 时按原文返回", async () => {
    expect(await resolveLyricText("[00:01.00]原文")).toBe("[00:01.00]原文");
  });

  it("空值返回空串", async () => {
    expect(await resolveLyricText("")).toBe("");
  });

  it("URL + 纯 LRC 文本响应 → 原样返回文本", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, text: async () => "[00:01.00]来自接口" }))
    );
    expect(await resolveLyricText("https://x.test/lrc")).toBe("[00:01.00]来自接口");
  });

  it("URL + NeteaseCloudMusicApi 的 {lrc:{lyric}} 形态 → 取内层歌词", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () => JSON.stringify({ lrc: { lyric: "[00:02.00]嵌套歌词" } }),
      }))
    );
    expect(await resolveLyricText("https://x.test/lyric")).toBe("[00:02.00]嵌套歌词");
  });

  it("请求失败或响应异常时返回空串（顶部不显示，而不是抛错）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, text: async () => "boom" })));
    expect(await resolveLyricText("https://x.test/lrc")).toBe("");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );
    expect(await resolveLyricText("https://x.test/lrc")).toBe("");
  });
});

/**
 * 歌词居中滚动的位置计算。
 *
 * 这块踩过一个坑：原来用 `active.offsetTop` 算位置，而歌词容器不是定位元素，
 * offsetTop 取到的是相对更外层祖先（.mp-dialog）的距离，越往下偏得越多，
 * scrollTo 直接冲到容器底部 —— 表现就是「歌词被拉到底、不跟歌走」。
 * 现在改为传视口坐标（getBoundingClientRect），把算法钉在这里。
 */
describe("centeredScrollTop（把当前句滚到容器正中）", () => {
  it("目标行在内容中部时，滚到它居中", () => {
    // 容器可视 100px，行在内容里偏移 200px、自身高 20px → 200 - 50 + 10
    expect(centeredScrollTop(0, 100, 0, 200, 20)).toBe(160);
  });

  it("容器已滚动过：视口坐标要补回 scrollTop 才是内容内偏移", () => {
    // 容器已滚 150px，行在视口里距容器顶 50px → 内容内偏移 = 50 + 150 = 200
    expect(centeredScrollTop(0, 100, 150, 50, 20)).toBe(160);
  });

  it("用行与容器的相对差，不受页面自身滚动影响", () => {
    // 容器顶 300、行顶 350、容器未滚 → 内容内偏移 50
    expect(centeredScrollTop(300, 100, 0, 350, 20)).toBe(10);
  });

  it("靠顶部的行不会算出负值", () => {
    expect(centeredScrollTop(0, 100, 0, 10, 20)).toBe(0);
    expect(centeredScrollTop(0, 100, 0, 0, 20)).toBe(0);
  });
});
