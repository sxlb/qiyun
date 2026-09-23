import { describe, it, expect, beforeEach } from "vitest";
import { render, act, waitFor } from "@testing-library/react";
import { useAudioPlayer, DEFAULT_VOLUME } from "@/components/useAudioPlayer";

/**
 * 静音/音量的集成回归：直接跑 useAudioPlayer（挂载时读 localStorage + 交互后写回）。
 * 对应线上现象「音乐静音模式关不掉」——首次访问音量被读成 0，页面无声、喇叭显示静音态，
 * 且此时无论点喇叭还是拖音量条都无法恢复声音。
 */
function Harness({ onApi }: { onApi: (api: ReturnType<typeof useAudioPlayer>) => void }) {
  const api = useAudioPlayer({ songApi: "", songId: "" });
  onApi(api);
  return null;
}

let api: ReturnType<typeof useAudioPlayer>;

function setup() {
  render(
    <Harness
      onApi={(a) => {
        api = a;
      }}
    />
  );
}

describe("useAudioPlayer 音量 / 静音", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("localStorage 无记录时保持默认音量（不会因 Number(null)===0 被设成 0）", async () => {
    setup();
    await waitFor(() => expect(api.muted).toBe(false));
    expect(api.volume).toBe(DEFAULT_VOLUME);
    expect(localStorage.getItem("music-player-volume")).toBeNull();
  });

  it("存量为 0 时点喇叭能恢复到默认音量并落盘（关不掉静音的回归）", async () => {
    localStorage.setItem("music-player-volume", "0");
    setup();
    await waitFor(() => expect(api.volume).toBe(0));

    act(() => api.toggleMuted());

    expect(api.muted).toBe(false);
    expect(api.volume).toBe(DEFAULT_VOLUME);
    expect(localStorage.getItem("music-player-volume")).toBe(String(DEFAULT_VOLUME));
    expect(localStorage.getItem("music-player-muted")).toBe("0");
  });

  it("静音态下拖动音量条会同时解除静音", async () => {
    localStorage.setItem("music-player-volume", "0.4");
    localStorage.setItem("music-player-muted", "1");
    setup();
    await waitFor(() => expect(api.muted).toBe(true));

    act(() => api.changeVolume(0.6));

    expect(api.muted).toBe(false);
    expect(api.volume).toBe(0.6);
    expect(localStorage.getItem("music-player-muted")).toBe("0");
    expect(localStorage.getItem("music-player-volume")).toBe("0.6");
  });

  it("存量为 0 时取消静音恢复的是上次的非零音量", async () => {
    localStorage.setItem("music-player-volume", "0.35");
    setup();
    await waitFor(() => expect(api.volume).toBe(0.35));

    act(() => api.changeVolume(0)); // 拖到 0：图标进入静音态
    act(() => api.toggleMuted()); // 再点喇叭：应恢复 0.35 而不是 0
    expect(api.volume).toBe(0.35);
    expect(api.muted).toBe(false);
  });
});
