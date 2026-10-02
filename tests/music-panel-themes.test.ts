import { describe, it, expect } from "vitest";
import {
  DEFAULT_MUSIC_PANEL_STYLE,
  MUSIC_PANEL_STYLE_OPTIONS,
  FOLLOW_SITE,
  resolveMusicPanelStyle,
} from "@/components/musicPanelThemes";

/**
 * 音乐面板风格的取值与解析。
 *
 * 两层配置：后台的站点默认（profile.musicPanelStyle）+ 本机的 localStorage 覆盖。
 * 本机可选择「跟随站点」（FOLLOW_SITE），此时回落到站点默认；
 * 任一层是空值或非法值时逐级回落，最终兜底到 DEFAULT_MUSIC_PANEL_STYLE。
 */
describe("resolveMusicPanelStyle（风格解析）", () => {
  it("本机选了具体风格 → 用本机的", () => {
    expect(resolveMusicPanelStyle({ siteDefault: "mono", localOverride: "editorial" })).toBe(
      "editorial"
    );
  });

  it("本机是「跟随站点」→ 用站点默认", () => {
    expect(resolveMusicPanelStyle({ siteDefault: "editorial", localOverride: FOLLOW_SITE })).toBe(
      "editorial"
    );
  });

  it("本机为空 → 用站点默认", () => {
    expect(resolveMusicPanelStyle({ siteDefault: "mono", localOverride: null })).toBe("mono");
    expect(resolveMusicPanelStyle({ siteDefault: "mono" })).toBe("mono");
  });

  it("站点默认非法或为空 → 兜底到默认风格（甲·黑胶）", () => {
    expect(resolveMusicPanelStyle({ siteDefault: "glass", localOverride: FOLLOW_SITE })).toBe(
      DEFAULT_MUSIC_PANEL_STYLE
    );
    expect(resolveMusicPanelStyle({ siteDefault: "", localOverride: "" })).toBe(
      DEFAULT_MUSIC_PANEL_STYLE
    );
    expect(resolveMusicPanelStyle({})).toBe(DEFAULT_MUSIC_PANEL_STYLE);
  });

  it("本机值非法（旧版残留的 glass 等）→ 视为跟随站点，而不是直接兜底", () => {
    expect(resolveMusicPanelStyle({ siteDefault: "mono", localOverride: "glass" })).toBe("mono");
  });

  it("默认风格是甲·黑胶暖色（已下线的玻璃不再是默认）", () => {
    expect(DEFAULT_MUSIC_PANEL_STYLE).toBe("vinyl");
  });
});

describe("MUSIC_PANEL_STYLE_OPTIONS（后台下拉用）", () => {
  it("只提供三套新风格，不含已下线的 glass", () => {
    expect(MUSIC_PANEL_STYLE_OPTIONS.map((o) => o.value)).toEqual([
      "vinyl",
      "editorial",
      "mono",
    ]);
  });

  it("每项都有中文标签与说明", () => {
    for (const option of MUSIC_PANEL_STYLE_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.hint.length).toBeGreaterThan(0);
    }
  });
});
