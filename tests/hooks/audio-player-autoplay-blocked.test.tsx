// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, act, waitFor } from "@testing-library/react";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";

/**
 * 自动播放被浏览器策略拦截后的兜底。
 *
 * 线上现象（手机版 Edge）：后台开着「自动播放」，进站却一声不响，也没有任何提示 ——
 * 移动端浏览器在「用户尚未与页面交互」时一律以 `NotAllowedError` 拒绝 `play()`。
 * 兜底方案是：识别出这类拦截后标记为「待交互续播」，在第一次点击 / 触摸 / 按键时自动开始，
 * 并给访客一个可照做的提示（把手呼吸圈 + 抽屉文案）。
 *
 * 关键边界：只有 `NotAllowedError` 才走兜底。音频源 404、解码失败这类错误重试也没用，
 * 不能把它们也挂上"等交互自动播放"（否则会看起来像随机放歌）。
 */

function Harness({
  onApi,
  autoplay = true,
}: {
  onApi: (api: ReturnType<typeof useAudioPlayer>) => void;
  autoplay?: boolean;
}) {
  const api = useAudioPlayer({
    songApi: "https://music.example.com",
    songServer: "netease",
    songId: "123",
    autoplay,
  });
  onApi(api);
  // 与 MusicProvider 一致：<audio> 常驻挂载，ref 回调把元素交给播放层
  return <audio ref={api.setAudioEl} />;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** 桩 /api/music：返回一首歌（其余请求给空对象） */
function stubMusicFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/music")) {
        return jsonResponse([
          {
            id: 1,
            name: "测试歌曲",
            artist: "测试歌手",
            url: "https://cdn.example.com/a.mp3",
          },
        ]);
      }
      return jsonResponse({});
    })
  );
}

/** 造一个「自动播放被策略拦截」的拒绝值 */
function notAllowedError(): Error {
  const e = new Error("play() failed because the user didn't interact with the document first");
  e.name = "NotAllowedError";
  return e;
}

let api: ReturnType<typeof useAudioPlayer>;

beforeEach(() => {
  localStorage.clear();
  // jsdom 未实现媒体播放控制，不打桩会在控制台刷 "Not implemented" 噪音
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useAudioPlayer · 自动播放被拦截的兜底", () => {
  it("被策略拦截时标记为待交互续播，首次点击后自动开始播放，且只续播一次", async () => {
    stubMusicFetch();
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockRejectedValueOnce(notAllowedError()) // 自动播放这一次：被浏览器拦截
      .mockResolvedValue(undefined); // 用户交互之后：正常播放

    render(
      <Harness
        onApi={(a) => {
          api = a;
        }}
      />
    );

    // 拦截被识别出来：进入「待交互续播」，而不是静默失败
    await waitFor(() => expect(api.autoplayBlocked).toBe(true));
    expect(api.isPlaying).toBe(false);

    await act(async () => {
      window.dispatchEvent(new Event("pointerdown"));
    });

    await waitFor(() => expect(api.isPlaying).toBe(true));
    expect(api.autoplayBlocked).toBe(false);
    expect(play).toHaveBeenCalledTimes(2);

    // 兜底监听是一次性的：再一次交互不该重复触发播放
    await act(async () => {
      window.dispatchEvent(new Event("click"));
    });
    expect(play).toHaveBeenCalledTimes(2);
  });

  it("音频源本身的失败不挂兜底（重试也救不回来，避免随机放歌）", async () => {
    stubMusicFetch();
    const boom = new Error("加载失败");
    boom.name = "NotSupportedError";
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(boom);

    render(
      <Harness
        onApi={(a) => {
          api = a;
        }}
      />
    );

    await waitFor(() => expect(play).toHaveBeenCalled());
    await act(async () => {});

    expect(api.autoplayBlocked).toBe(false);
    expect(api.isPlaying).toBe(false);
  });

  it("未开启自动播放时不做任何播放尝试（不打扰访客）", async () => {
    stubMusicFetch();
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);

    render(
      <Harness
        autoplay={false}
        onApi={(a) => {
          api = a;
        }}
      />
    );

    await waitFor(() => expect(api.playlist).toHaveLength(1));
    await act(async () => {});

    expect(play).not.toHaveBeenCalled();
    expect(api.autoplayBlocked).toBe(false);
  });
});
