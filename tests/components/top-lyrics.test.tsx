// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";

/**
 * 顶部常驻歌词胶囊：
 * - 播放中显示「♪ + 当前句」
 * - 暂停 / 无歌词 / 未到首句时收起歌词文字，只留可点的音符入口（位置不跳）
 * - 点音符打开音乐列表面板
 *
 * 当前句来自音乐上下文（歌词已上移到 useAudioPlayer，弹窗关掉也还在），
 * 这里把上下文读取替身掉，只验证组件的渲染与交互契约。
 */

const music = {
  lyricLines: [] as { time: number; text: string }[],
  lyricIndex: -1,
  isPlaying: false,
  prefs: { topLyrics: true, showLyrics: true, showPlaylist: true, lyricSize: 4 },
  setBoxOpen: vi.fn(),
};

vi.mock("@/components/home/MusicPlayer", () => ({
  useMusic: () => music,
}));

const { TopLyrics } = await import("@/components/home/DecorativeEffects");

describe("TopLyrics（顶部歌词胶囊）", () => {
  beforeEach(() => {
    music.lyricLines = [];
    music.lyricIndex = -1;
    music.isPlaying = false;
    music.prefs.topLyrics = true;
    music.prefs.lyricSize = 4;
    music.setBoxOpen.mockClear();
  });

  it("播放中显示当前句，且只显示当前那一句", () => {
    music.lyricLines = [
      { time: 0, text: "愿时光温柔" },
      { time: 10, text: "伴你左右" },
    ];
    music.lyricIndex = 1;
    music.isPlaying = true;

    const { container } = render(<TopLyrics enabled />);
    expect(container.textContent).toContain("伴你左右");
    expect(container.textContent).not.toContain("愿时光温柔");
  });

  it("暂停后收起歌词文字，只留音符（胶囊仍在原地）", () => {
    music.lyricLines = [{ time: 0, text: "有词" }];
    music.lyricIndex = 0;
    music.isPlaying = false;

    const { container } = render(<TopLyrics enabled />);
    expect(container.firstElementChild).toBeTruthy();
    expect(container.textContent).toContain("♪");
    expect(container.textContent).not.toContain("有词");
  });

  it("还没到第一句（index 为 -1）时也只留音符", () => {
    music.lyricLines = [{ time: 30, text: "还没到" }];
    music.lyricIndex = -1;
    music.isPlaying = true;

    const { container } = render(<TopLyrics enabled />);
    expect(container.textContent).toContain("♪");
    expect(container.textContent).not.toContain("还没到");
  });

  it("没有歌词时同样只留音符入口", () => {
    const { container } = render(<TopLyrics enabled />);
    expect(container.textContent).toContain("♪");
  });

  it("点音符打开音乐面板", () => {
    const { getByRole } = render(<TopLyrics enabled />);
    fireEvent.click(getByRole("button", { name: "打开音乐面板" }));
    expect(music.setBoxOpen).toHaveBeenCalledWith(true);
  });

  it("音符是可访问按钮，整块不再 aria-hidden", () => {
    const { getByRole, container } = render(<TopLyrics enabled />);
    expect(getByRole("button", { name: "打开音乐面板" })).toBeTruthy();
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBeNull();
  });

  it("歌词文字本身仍对读屏隐藏（每几秒一变，不该播报）", () => {
    music.lyricLines = [{ time: 0, text: "有词" }];
    music.lyricIndex = 0;
    music.isPlaying = true;

    const { container } = render(<TopLyrics enabled />);
    expect(container.querySelector("[aria-hidden='true']")?.textContent).toBe("有词");
  });

  it("总开关关闭时不渲染", () => {
    const { container } = render(<TopLyrics enabled={false} />);
    expect(container.textContent).toBe("");
  });

  it("面板设置里关掉「顶部常驻歌词」后不渲染", () => {
    music.prefs.topLyrics = false;

    const { container } = render(<TopLyrics enabled />);
    expect(container.textContent).toBe("");
  });

  it("胶囊带 .top-lyric 与 data-size，字号由 CSS 按档位给出（移动端/桌面端两套值）", () => {
    music.prefs.lyricSize = 6;

    const { container } = render(<TopLyrics enabled />);
    const capsule = container.firstElementChild as HTMLElement;
    expect(capsule.className).toContain("top-lyric");
    expect(capsule.getAttribute("data-size")).toBe("6");
  });

  it("字号不再写死在行内，档位换档即换值", () => {
    const { container } = render(<TopLyrics enabled />);
    // 旧的写死字号（text-[11px]）必须已经移除，否则换档只改 CSS 不生效
    expect(container.innerHTML).not.toContain("text-[11px]");
  });
});
