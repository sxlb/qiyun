// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, act, waitFor } from "@testing-library/react";
import { useAudioPlayer, DEFAULT_VOLUME, type UseAudioPlayerProps } from "@/hooks/useAudioPlayer";
import {
  AUDIO_LAST_TRACK_KEY,
  AUDIO_MUTED_KEY,
  AUDIO_PLAY_MODE_KEY,
  AUDIO_VOLUME_KEY,
  DEFAULT_MUSIC_PANEL_PREFS,
  MUSIC_PREFS_RESET_EVENT,
  type MusicPanelPrefs,
} from "@/lib/musicPanelThemes";

/**
 * 音乐面板「播放行为」三项偏好的集成回归。
 *
 * 这里刻意跑真实的 useAudioPlayer（而不是纯函数）：这三项都是「挂载时读一次存储 +
 * 运行时写回」的行为，纯函数测不到它们与 prefsReady 时序的关系 ——
 * 而时序正是最容易出错的地方（偏好晚一帧就绪，初始化就会用默认值把用户设置顶掉）。
 */

const TRACKS = [
  { id: "a", name: "歌 A", artist: "歌手 A", url: "https://a.mp3" },
  { id: "b", name: "歌 B", artist: "歌手 B", url: "https://b.mp3" },
];

let api: ReturnType<typeof useAudioPlayer>;

function Harness(props: UseAudioPlayerProps) {
  api = useAudioPlayer(props);
  return null;
}

/** 默认带上歌单参数，让 loadPlaylist 真正跑起来 */
function setup(overrides: Partial<UseAudioPlayerProps> = {}) {
  return render(
    <Harness songApi="https://music.example.com" songServer="netease" songId="1" {...overrides} />
  );
}

function prefsWith(overrides: Partial<MusicPanelPrefs> = {}): MusicPanelPrefs {
  return { ...DEFAULT_MUSIC_PANEL_PREFS, ...overrides };
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(TRACKS), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
    )
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("初始音量（本机偏好）", () => {
  it("没有记住过音量时用偏好里的初始音量，且不写回存储", async () => {
    setup({ prefs: prefsWith({ volume: 80 }) });
    await waitFor(() => expect(api.volume).toBeCloseTo(0.8));
    // 初始音量是「默认值」，不是用户操作结果：落盘会把它伪装成「用户调过」
    expect(localStorage.getItem(AUDIO_VOLUME_KEY)).toBeNull();
  });

  it("已经记住过音量时以存储值为准，偏好只兜底", async () => {
    localStorage.setItem(AUDIO_VOLUME_KEY, "0.25");
    setup({ prefs: prefsWith({ volume: 80 }) });
    await waitFor(() => expect(api.volume).toBeCloseTo(0.25));
  });

  it("偏好晚一帧就绪时也必须以偏好为准（否则用户设置会被默认值顶掉）", async () => {
    const props = { prefs: prefsWith({ volume: 90 }) };
    const { rerender } = setup({ ...props, prefsReady: false });

    // 未就绪：保持内置默认，不做任何初始化
    expect(api.volume).toBe(DEFAULT_VOLUME);

    rerender(
      <Harness songApi="https://music.example.com" songId="1" {...props} prefsReady />
    );
    await waitFor(() => expect(api.volume).toBeCloseTo(0.9));
  });

  it("音量为 0 的偏好是合法设置，不会被当成「未设置」而回落到默认", async () => {
    setup({ prefs: prefsWith({ volume: 0 }) });
    await waitFor(() => expect(api.volume).toBe(0));
  });
});

describe("记住播放模式", () => {
  it("开启时从存储恢复上次的播放模式", async () => {
    localStorage.setItem(AUDIO_PLAY_MODE_KEY, "single");
    setup({ prefs: prefsWith({ rememberPlayMode: true }) });
    await waitFor(() => expect(api.playMode).toBe("single"));
  });

  it("关闭时不恢复（保持列表循环）", async () => {
    localStorage.setItem(AUDIO_PLAY_MODE_KEY, "single");
    setup({ prefs: prefsWith({ rememberPlayMode: false }) });
    await waitFor(() => expect(api.playlist).toHaveLength(2));
    expect(api.playMode).toBe("loop");
  });

  it("存储里是非法值时回落列表循环，不会把播放模式置成空", async () => {
    localStorage.setItem(AUDIO_PLAY_MODE_KEY, "teleport");
    setup({ prefs: prefsWith({ rememberPlayMode: true }) });
    await waitFor(() => expect(api.playlist).toHaveLength(2));
    expect(api.playMode).toBe("loop");
  });

  it("开启时切换播放模式会落盘，关闭时不落盘", async () => {
    const { unmount } = setup({ prefs: prefsWith({ rememberPlayMode: true }) });
    await waitFor(() => expect(api.playlist).toHaveLength(2));
    act(() => api.cyclePlayMode());
    await waitFor(() => expect(localStorage.getItem(AUDIO_PLAY_MODE_KEY)).toBe(api.playMode));
    unmount();

    localStorage.removeItem(AUDIO_PLAY_MODE_KEY);
    setup({ prefs: prefsWith({ rememberPlayMode: false }) });
    await waitFor(() => expect(api.playlist).toHaveLength(2));
    act(() => api.cyclePlayMode());
    expect(localStorage.getItem(AUDIO_PLAY_MODE_KEY)).toBeNull();
  });
});

describe("续播上次曲目", () => {
  it("歌单加载后自动选中上次那首，但**不**自动播放", async () => {
    localStorage.setItem(AUDIO_LAST_TRACK_KEY, "b");
    setup({ prefs: prefsWith({ resumeLastTrack: true }) });

    await waitFor(() => expect(api.currentTrack?.id).toBe("b"));
    expect(api.isPlaying).toBe(false);
  });

  it("关闭该偏好时不恢复", async () => {
    localStorage.setItem(AUDIO_LAST_TRACK_KEY, "b");
    setup({ prefs: prefsWith({ resumeLastTrack: false }) });
    await waitFor(() => expect(api.playlist).toHaveLength(2));
    expect(api.currentTrack).toBeNull();
  });

  it("上次的曲目已不在歌单里（换过歌单）时静默忽略，不选中别的歌", async () => {
    localStorage.setItem(AUDIO_LAST_TRACK_KEY, "no-such-track");
    setup({ prefs: prefsWith({ resumeLastTrack: true }) });
    await waitFor(() => expect(api.playlist).toHaveLength(2));
    expect(api.currentTrack).toBeNull();
  });

  it("选中曲目后会把 id 落盘，供下次续播", async () => {
    setup({ prefs: prefsWith({ resumeLastTrack: true }) });
    await waitFor(() => expect(api.playlist).toHaveLength(2));

    act(() => api.selectTrack(api.playlist[1]));
    await waitFor(() => expect(localStorage.getItem(AUDIO_LAST_TRACK_KEY)).toBe("b"));
  });
});

describe("「恢复默认」事件", () => {
  it("把音量 / 静音 / 播放模式一起复位（光删 localStorage 本轮不生效）", async () => {
    localStorage.setItem(AUDIO_VOLUME_KEY, "0.9");
    localStorage.setItem(AUDIO_MUTED_KEY, "1");
    setup({ prefs: prefsWith({ rememberPlayMode: true }) });
    await waitFor(() => expect(api.volume).toBeCloseTo(0.9));
    await waitFor(() => expect(api.muted).toBe(true));

    act(() => api.cyclePlayMode());
    expect(api.playMode).toBe("single");

    act(() => {
      window.dispatchEvent(new Event(MUSIC_PREFS_RESET_EVENT));
    });

    expect(api.volume).toBeCloseTo(DEFAULT_MUSIC_PANEL_PREFS.volume / 100);
    expect(api.muted).toBe(false);
    expect(api.playMode).toBe("loop");
  });

  it("卸载后收到事件不会报错（监听器已清理）", async () => {
    const { unmount } = setup({ prefs: prefsWith() });
    await waitFor(() => expect(api.playlist).toHaveLength(2));
    unmount();
    expect(() => {
      window.dispatchEvent(new Event(MUSIC_PREFS_RESET_EVENT));
    }).not.toThrow();
  });
});
