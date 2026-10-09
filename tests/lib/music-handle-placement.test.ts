import { describe, it, expect } from "vitest";
import {
  ALL_MUSIC_LOCAL_KEYS,
  AUTOPLAY_KEY,
  DEFAULT_HANDLE_PLACEMENT,
  DEFAULT_MUSIC_PANEL_PREFS,
  HANDLE_BOTTOM_KEY,
  HANDLE_SIDE_KEY,
  MUSIC_PANEL_BOOL_KEYS,
  parseHandleBottom,
  parseHandleSide,
  parseMusicPanelPrefs,
  readHandlePlacement,
  writeHandlePlacement,
} from "@/lib/musicPanelThemes";

/**
 * 音乐侧栏把手的停靠位置，以及「自动播放」的默认值语义。
 *
 * 两件事都是这一轮新增、且都容易被后来的改动悄悄改坏：
 * - 位置：默认必须落在左侧贴底，脏值不能把它带到屏幕外（NaN / 负数 / 空串）；
 * - 自动播放：默认必须关（页面一打开就出声是最容易被投诉的行为），
 *   而后台配置的站点开关只当「访客从未设置过」时的初值，不能被静默忽略。
 */

/** 最小可用的 Storage 替身（本模块只用到 getItem / setItem） */
function makeStorage(init: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(init));
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
}

describe("把手停靠位置：默认左侧贴底，脏值一律回落", () => {
  it("默认是左侧、距底 16px", () => {
    expect(DEFAULT_HANDLE_PLACEMENT).toEqual({ side: "left", bottom: 16 });
    expect(readHandlePlacement(makeStorage())).toEqual(DEFAULT_HANDLE_PLACEMENT);
  });

  it("停靠侧只认 right，其余（含脏值）都是左侧", () => {
    expect(parseHandleSide("right")).toBe("right");
    expect(parseHandleSide("left")).toBe("left");
    expect(parseHandleSide(null)).toBe("left");
    expect(parseHandleSide("")).toBe("left");
    expect(parseHandleSide("RIGHT")).toBe("left");
    expect(parseHandleSide("center")).toBe("left");
  });

  it("底部距离：空串 / 非数字 / 负数都回落默认，不当成 0（否则会贴到最底）", () => {
    expect(parseHandleBottom("300")).toBe(300);
    expect(parseHandleBottom("0")).toBe(0);
    expect(parseHandleBottom(null)).toBe(16);
    expect(parseHandleBottom("")).toBe(16);
    expect(parseHandleBottom("  ")).toBe(16);
    expect(parseHandleBottom("abc")).toBe(16);
    expect(parseHandleBottom("-40")).toBe(16);
  });

  it("写入后能原样读回", () => {
    const storage = makeStorage();
    writeHandlePlacement(storage, { side: "right", bottom: 419 });
    expect(readHandlePlacement(storage)).toEqual({ side: "right", bottom: 419 });
    expect(storage.getItem(HANDLE_SIDE_KEY)).toBe("right");
    expect(storage.getItem(HANDLE_BOTTOM_KEY)).toBe("419");
  });

  it("两个位置键都在「恢复默认设置」的清理名单里", () => {
    // 漏清的症状：点了恢复默认，把手还停在拖动后的位置
    expect(ALL_MUSIC_LOCAL_KEYS).toContain(HANDLE_SIDE_KEY);
    expect(ALL_MUSIC_LOCAL_KEYS).toContain(HANDLE_BOTTOM_KEY);
  });
});

describe("自动播放：默认关闭，站点开关只当访客未设置时的初值", () => {
  it("默认关（页面一打开就出声必须由访客自己打开）", () => {
    expect(DEFAULT_MUSIC_PANEL_PREFS.autoplay).toBe(false);
    expect(parseMusicPanelPrefs({}).autoplay).toBe(false);
  });

  it("后台站点开关为开启时，访客没设过就沿用开启", () => {
    // 否则老部署里已开自动播放的站点会被本机默认值静默关掉
    expect(parseMusicPanelPrefs({}, { autoplay: true }).autoplay).toBe(true);
    expect(parseMusicPanelPrefs({ autoplay: null }, { autoplay: true }).autoplay).toBe(true);
  });

  it("访客显式设过就以访客为准（站点开着也能关掉，站点关着也能打开）", () => {
    expect(parseMusicPanelPrefs({ autoplay: "0" }, { autoplay: true }).autoplay).toBe(false);
    expect(parseMusicPanelPrefs({ autoplay: "1" }, { autoplay: false }).autoplay).toBe(true);
  });

  it("落盘键收敛在 BOOL_KEYS 表里（新增偏好只需补表，不必改读取端）", () => {
    expect(MUSIC_PANEL_BOOL_KEYS.autoplay).toBe(AUTOPLAY_KEY);
  });
});
