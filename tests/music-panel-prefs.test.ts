import { describe, it, expect } from "vitest";
import {
  DEFAULT_LYRIC_SIZE,
  DEFAULT_MUSIC_PANEL_PREFS,
  LYRIC_SIZE_OPTIONS,
  MUSIC_PANEL_TRAITS,
  musicPanelTraits,
  lyricSizeLabel,
  parseBoolPref,
  formatBoolPref,
  parseLyricSize,
  parseMusicPanelPrefs,
  TOP_LYRICS_KEY,
  TOP_LYRICS_SIZE_KEY,
  SHOW_LYRICS_KEY,
  SHOW_PLAYLIST_KEY,
} from "@/lib/musicPanelThemes";

/**
 * 面板内的本机偏好：布尔以 "1" / "0" 落盘，其它一律回落默认值。
 * 关键约定：脏值不能把「默认开启」的开关关掉（否则 localStorage 里一个残留空串就够呛）。
 */
describe("parseBoolPref（布尔偏好解析）", () => {
  it("认 1 / 0", () => {
    expect(parseBoolPref("1", false)).toBe(true);
    expect(parseBoolPref("0", true)).toBe(false);
  });

  it("空值与垃圾值回落到默认值，而不是 false", () => {
    expect(parseBoolPref(null, true)).toBe(true);
    expect(parseBoolPref(undefined, true)).toBe(true);
    expect(parseBoolPref("", true)).toBe(true);
    expect(parseBoolPref("true", true)).toBe(true);
    expect(parseBoolPref("yes", false)).toBe(false);
  });

  it("formatBoolPref 与 parseBoolPref 互逆", () => {
    expect(parseBoolPref(formatBoolPref(true), false)).toBe(true);
    expect(parseBoolPref(formatBoolPref(false), true)).toBe(false);
  });
});

/** 顶部悬浮歌词的字号档位：7 档，非法值一律回落默认档（4 · 标准） */
describe("悬浮歌词字号档位（parseLyricSize）", () => {
  it("共 7 档，档位从 1 到 7 连续且各有中文名", () => {
    expect(LYRIC_SIZE_OPTIONS.map((o) => o.value)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const option of LYRIC_SIZE_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
    }
  });

  it("合法档位原样返回（字符串与数字都认）", () => {
    expect(parseLyricSize("7")).toBe(7);
    expect(parseLyricSize(1)).toBe(1);
    expect(parseLyricSize(4)).toBe(4);
  });

  it("非法值（空 / 越界 / 非数字）回落默认档，而不是崩掉", () => {
    expect(parseLyricSize(null)).toBe(DEFAULT_LYRIC_SIZE);
    expect(parseLyricSize(undefined)).toBe(DEFAULT_LYRIC_SIZE);
    expect(parseLyricSize("")).toBe(DEFAULT_LYRIC_SIZE);
    expect(parseLyricSize("0")).toBe(DEFAULT_LYRIC_SIZE);
    expect(parseLyricSize("8")).toBe(DEFAULT_LYRIC_SIZE);
    expect(parseLyricSize("abc")).toBe(DEFAULT_LYRIC_SIZE);
  });

  it("默认档是标准（4）", () => {
    expect(DEFAULT_LYRIC_SIZE).toBe(4);
  });

  it("lyricSizeLabel 回显中文名，越界值返回空串", () => {
    expect(lyricSizeLabel(4)).toBe("标准");
    expect(lyricSizeLabel(7)).toBe("特大");
    expect(lyricSizeLabel(99 as 1)).toBe("");
  });
});

describe("parseMusicPanelPrefs（面板偏好）", () => {
  it("缺省时全部取默认值（开关默认全开、字号默认标准）", () => {
    expect(parseMusicPanelPrefs({})).toEqual(DEFAULT_MUSIC_PANEL_PREFS);
    expect(DEFAULT_MUSIC_PANEL_PREFS).toEqual({
      topLyrics: true,
      showLyrics: true,
      showPlaylist: true,
      lyricSize: 4,
    });
  });

  it("逐键独立解析：关掉歌词不影响曲目", () => {
    expect(parseMusicPanelPrefs({ showLyrics: "0" })).toEqual({
      topLyrics: true,
      showLyrics: false,
      showPlaylist: true,
      lyricSize: 4,
    });
  });

  it("字号与开关互不干扰，各自独立解析", () => {
    const prefs = parseMusicPanelPrefs({ showPlaylist: "0", lyricSize: "6" });
    expect(prefs.showPlaylist).toBe(false);
    expect(prefs.lyricSize).toBe(6);
    expect(prefs.topLyrics).toBe(true);
  });

  it("历史脏值被忽略", () => {
    expect(parseMusicPanelPrefs({ topLyrics: "on" })).toEqual(DEFAULT_MUSIC_PANEL_PREFS);
    expect(parseMusicPanelPrefs({ lyricSize: "huge" })).toEqual(DEFAULT_MUSIC_PANEL_PREFS);
  });

  it("四个键名与既有 music-player-* 前缀一致", () => {
    expect([TOP_LYRICS_KEY, SHOW_LYRICS_KEY, SHOW_PLAYLIST_KEY, TOP_LYRICS_SIZE_KEY]).toEqual([
      "music-player-top-lyrics",
      "music-player-show-lyrics",
      "music-player-show-playlist",
      "music-player-top-lyrics-size",
    ]);
  });
});

/**
 * 三套风格的结构差异表：组件按它决定「有没有唱片 / 进度条形态 / 歌词对齐」。
 * 这张表一旦被改错，三套风格就会退化成「只换配色」—— 正是上一版返工的原因，
 * 所以在这里把关键差异钉死。
 */
describe("MUSIC_PANEL_TRAITS（结构差异）", () => {
  it("只有甲（黑胶）渲染中央唱片", () => {
    expect(MUSIC_PANEL_TRAITS.vinyl.disc).toBe(true);
    expect(MUSIC_PANEL_TRAITS.editorial.disc).toBe(false);
    expect(MUSIC_PANEL_TRAITS.mono.disc).toBe(false);
  });

  it("只有丙（等宽）用段式 LED 进度条", () => {
    expect(MUSIC_PANEL_TRAITS.mono.progress).toBe("led");
    expect(MUSIC_PANEL_TRAITS.vinyl.progress).toBe("line");
    expect(MUSIC_PANEL_TRAITS.editorial.progress).toBe("line");
  });

  it("只有丙的歌词左对齐并带 > 前缀", () => {
    expect(MUSIC_PANEL_TRAITS.mono.lyricAlign).toBe("left");
    expect(MUSIC_PANEL_TRAITS.mono.lyricCursor).toBe("> ");
    expect(MUSIC_PANEL_TRAITS.vinyl.lyricAlign).toBe("center");
    expect(MUSIC_PANEL_TRAITS.vinyl.lyricCursor).toBe("");
    expect(MUSIC_PANEL_TRAITS.editorial.lyricAlign).toBe("center");
  });

  it("甲用 SIDE A、乙丙用 NOW PLAYING；乙丙头部带曲序计数", () => {
    expect(MUSIC_PANEL_TRAITS.vinyl.side).toBe("SIDE A");
    expect(MUSIC_PANEL_TRAITS.vinyl.showCount).toBe(false);
    expect(MUSIC_PANEL_TRAITS.editorial.side).toBe("NOW PLAYING");
    expect(MUSIC_PANEL_TRAITS.mono.side).toBe("NOW PLAYING");
    expect(MUSIC_PANEL_TRAITS.editorial.showCount).toBe(true);
    expect(MUSIC_PANEL_TRAITS.mono.showCount).toBe(true);
  });

  it("曲目区块标题三套各不相同", () => {
    expect(MUSIC_PANEL_TRAITS.vinyl.listLabel).toBe("曲目");
    expect(MUSIC_PANEL_TRAITS.editorial.listLabel).toBe("目录");
    expect(MUSIC_PANEL_TRAITS.mono.listLabel).toBe("TRACKS");
  });

  it("musicPanelTraits 对每个风格都返回完整对象", () => {
    for (const style of ["vinyl", "editorial", "mono"] as const) {
      const traits = musicPanelTraits(style);
      expect(traits.side).toBeTruthy();
      expect(traits.lyricLabel).toBeTruthy();
      expect(typeof traits.disc).toBe("boolean");
    }
  });
});
