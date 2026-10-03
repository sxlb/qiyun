import { describe, it, expect, vi } from "vitest";
import {
  ALL_MUSIC_LOCAL_KEYS,
  AUDIO_VOLUME_KEY,
  DEFAULT_LYRIC_SIZE,
  DEFAULT_MUSIC_PANEL_PREFS,
  LYRIC_ALIGN_OPTIONS,
  LYRIC_SIZE_OPTIONS,
  MIN_PANEL_OPACITY,
  MUSIC_PANEL_BOOL_KEYS,
  MUSIC_PANEL_STYLE_KEY,
  MUSIC_PANEL_TRAITS,
  MUSIC_PANEL_VALUE_KEYS,
  musicPanelTraits,
  clampPanelOpacity,
  clampPercent,
  formatBoolPref,
  lyricSizeLabel,
  parseBoolPref,
  parseLyricAlign,
  parseLyricSize,
  parseMusicPanelPrefs,
  parsePercentPref,
  readMusicPanelPrefs,
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
  it("缺省时全部取默认值", () => {
    expect(parseMusicPanelPrefs({})).toEqual(DEFAULT_MUSIC_PANEL_PREFS);
  });

  it("默认值就是「不改变现有观感」的那一组：开关全开、字号标准、面板不透化、歌词对齐跟随风格", () => {
    expect(DEFAULT_MUSIC_PANEL_PREFS).toMatchObject({
      topLyrics: true,
      showLyrics: true,
      showPlaylist: true,
      lyricSize: 4,
      lyricAlign: "site",
      panelOpacity: 100,
      rememberPlayMode: true,
      resumeLastTrack: true,
      keepPlaying: true,
      hotkeys: true,
      mediaSession: true,
    });
    // 这两项是例外：默认开启会改变观感 / 多发一轮图片请求，故默认关
    expect(DEFAULT_MUSIC_PANEL_PREFS.trackCover).toBe(false);
    expect(DEFAULT_MUSIC_PANEL_PREFS.volume).toBe(40);
  });

  it("逐键独立解析：关掉歌词不影响曲目", () => {
    const prefs = parseMusicPanelPrefs({ showLyrics: "0" });
    expect(prefs.showLyrics).toBe(false);
    expect(prefs.showPlaylist).toBe(true);
    expect(prefs.topLyrics).toBe(true);
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
    expect(parseMusicPanelPrefs({ lyricAlign: "right" }).lyricAlign).toBe("site");
    expect(parseMusicPanelPrefs({ volume: "abc" }).volume).toBe(
      DEFAULT_MUSIC_PANEL_PREFS.volume
    );
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
 * 布尔偏好 → localStorage 键的映射表。
 * 这张表是唯一的键名来源，「恢复默认」也按它清理；漏一项的症状是「重置后某个开关还留着」。
 */
describe("MUSIC_PANEL_BOOL_KEYS（偏好键映射）", () => {
  it("覆盖 MusicPanelPrefs 的全部布尔字段，且键名互不重复", () => {
    const boolFields = Object.keys(DEFAULT_MUSIC_PANEL_PREFS).filter(
      (k) => typeof DEFAULT_MUSIC_PANEL_PREFS[k as keyof typeof DEFAULT_MUSIC_PANEL_PREFS] === "boolean"
    );
    expect(Object.keys(MUSIC_PANEL_BOOL_KEYS).sort()).toEqual(boolFields.sort());
    const values = Object.values(MUSIC_PANEL_BOOL_KEYS);
    expect(new Set(values).size).toBe(values.length);
  });

  it("全部键都带 music-player- 前缀，且不与数值键冲突", () => {
    for (const key of Object.values(MUSIC_PANEL_BOOL_KEYS)) {
      expect(key.startsWith("music-player-")).toBe(true);
    }
    const overlap = Object.values(MUSIC_PANEL_BOOL_KEYS).filter((k) =>
      Object.values(MUSIC_PANEL_VALUE_KEYS).includes(k as never)
    );
    expect(overlap).toEqual([]);
  });

  it("「恢复默认」的清理清单包含风格、全部偏好与播放行为键，且无重复", () => {
    for (const key of [
      MUSIC_PANEL_STYLE_KEY,
      ...Object.values(MUSIC_PANEL_BOOL_KEYS),
      ...Object.values(MUSIC_PANEL_VALUE_KEYS),
      AUDIO_VOLUME_KEY,
    ]) {
      expect(ALL_MUSIC_LOCAL_KEYS).toContain(key);
    }
    expect(new Set(ALL_MUSIC_LOCAL_KEYS).size).toBe(ALL_MUSIC_LOCAL_KEYS.length);
  });
});

describe("百分比档位（音量 / 面板不透明度）", () => {
  it("parsePercentPref 认数字与数字字符串，越界与垃圾值回落", () => {
    expect(parsePercentPref("70", 40)).toBe(70);
    expect(parsePercentPref(70, 40)).toBe(70);
    expect(parsePercentPref("70.4", 40)).toBe(70);
    expect(parsePercentPref("", 40)).toBe(40);
    expect(parsePercentPref(null, 40)).toBe(40);
    expect(parsePercentPref("abc", 40)).toBe(40);
    expect(parsePercentPref("-1", 40)).toBe(40);
    expect(parsePercentPref("101", 40)).toBe(40);
  });

  it("clampPercent 夹到 0-100 的整数，非数字回落默认", () => {
    expect(clampPercent(120)).toBe(100);
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(66.6)).toBe(67);
    expect(clampPercent(Number.NaN)).toBe(DEFAULT_MUSIC_PANEL_PREFS.volume);
  });

  it("面板不透明度有下限：再低文字就看不清了", () => {
    expect(clampPanelOpacity(10)).toBe(MIN_PANEL_OPACITY);
    expect(clampPanelOpacity(100)).toBe(100);
    // 越界值经 parseMusicPanelPrefs 也会被夹到下限，而不是原样留下
    expect(parseMusicPanelPrefs({ panelOpacity: "5" }).panelOpacity).toBe(MIN_PANEL_OPACITY);
  });
});

describe("歌词对齐（parseLyricAlign）", () => {
  it("三个合法取值原样返回，非法值一律视为「跟随风格」", () => {
    for (const option of LYRIC_ALIGN_OPTIONS) {
      expect(parseLyricAlign(option.value)).toBe(option.value);
    }
    expect(parseLyricAlign("right")).toBe("site");
    expect(parseLyricAlign(null)).toBe("site");
    expect(parseLyricAlign(undefined)).toBe("site");
  });
});

/** readMusicPanelPrefs：Provider 用它一次性读出全部偏好（键名表在模块内，调用方不逐个列） */
describe("readMusicPanelPrefs（从存储读取全部偏好）", () => {
  function fakeStorage(entries: Record<string, string>) {
    return { getItem: vi.fn((key: string) => entries[key] ?? null) } as unknown as Storage;
  }

  it("空存储 → 全默认", () => {
    expect(readMusicPanelPrefs(fakeStorage({}))).toEqual(DEFAULT_MUSIC_PANEL_PREFS);
  });

  it("逐个键都被读到：布尔、字号、音量、不透明度、对齐", () => {
    const storage = fakeStorage({
      [MUSIC_PANEL_BOOL_KEYS.showPlaylist]: "0",
      [MUSIC_PANEL_BOOL_KEYS.hotkeys]: "0",
      [MUSIC_PANEL_VALUE_KEYS.lyricSize]: "7",
      [MUSIC_PANEL_VALUE_KEYS.volume]: "80",
      [MUSIC_PANEL_VALUE_KEYS.panelOpacity]: "60",
      [MUSIC_PANEL_VALUE_KEYS.lyricAlign]: "left",
    });
    const prefs = readMusicPanelPrefs(storage);

    expect(prefs.showPlaylist).toBe(false);
    expect(prefs.hotkeys).toBe(false);
    expect(prefs.lyricSize).toBe(7);
    expect(prefs.volume).toBe(80);
    expect(prefs.panelOpacity).toBe(60);
    expect(prefs.lyricAlign).toBe("left");
    // 没存的键保持默认，不会被「读到了别的值」带着走
    expect(prefs.showLyrics).toBe(true);
  });

  it("每个布尔字段都会去读对应的键（新增偏好忘了接进读取端会在这里暴露）", () => {
    const storage = fakeStorage({});
    readMusicPanelPrefs(storage);
    for (const key of Object.values(MUSIC_PANEL_BOOL_KEYS)) {
      expect(storage.getItem).toHaveBeenCalledWith(key);
    }
    for (const key of Object.values(MUSIC_PANEL_VALUE_KEYS)) {
      expect(storage.getItem).toHaveBeenCalledWith(key);
    }
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
