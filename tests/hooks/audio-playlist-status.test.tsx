// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";

/**
 * 歌单状态（决定前台提示的措辞）。
 *
 * 背景：此前「没配置接口地址」与「配置了却拉不到歌单」共用同一句
 * 「尚未配置音乐歌单」。站主明明在后台选了「网易云官方 API（直连）」并填了歌单 ID，
 * 前台却提示他没配置 —— 照着提示去改，也不知道该改哪一项。
 * 这里锁住两者的区分，避免又退化回一句笼统的话。
 */

function Harness({
  onApi,
  songApi,
  songId,
}: {
  onApi: (api: ReturnType<typeof useAudioPlayer>) => void;
  songApi: string;
  songId: string;
}) {
  const api = useAudioPlayer({ songApi, songId });
  onApi(api);
  return <audio ref={api.setAudioEl} />;
}

let api: ReturnType<typeof useAudioPlayer>;

beforeEach(() => {
  localStorage.clear();
  // jsdom 未实现媒体控制，不打桩会在控制台刷 "Not implemented" 噪音
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useAudioPlayer · 歌单状态", () => {
  it("没填接口地址或歌单 ID 时是 unconfigured", async () => {
    render(
      <Harness
        songApi=""
        songId=""
        onApi={(a) => {
          api = a;
        }}
      />
    );

    await waitFor(() => expect(api.playlistStatus).toBe("unconfigured"));
  });

  it("配置了但歌单为空时是 empty，而不是「未配置」", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));

    render(
      <Harness
        songApi="https://music.163.com/api"
        songId="3778678"
        onApi={(a) => {
          api = a;
        }}
      />
    );

    await waitFor(() => expect(api.playlistStatus).toBe("empty"));
  });

  it("接口报错时同样是 empty（提示应指向「拉不到」而不是「没配置」）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));

    render(
      <Harness
        songApi="https://music.163.com/api"
        songId="3778678"
        onApi={(a) => {
          api = a;
        }}
      />
    );

    await waitFor(() => expect(api.playlistStatus).toBe("empty"));
  });

  it("拿到歌单时是 ready", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([{ id: 1, name: "歌一", url: "https://cdn/1.mp3" }]),
            { status: 200 }
          )
      )
    );

    render(
      <Harness
        songApi="https://music.163.com/api"
        songId="3778678"
        onApi={(a) => {
          api = a;
        }}
      />
    );

    await waitFor(() => expect(api.playlistStatus).toBe("ready"));
    expect(api.playlist).toHaveLength(1);
  });
});
