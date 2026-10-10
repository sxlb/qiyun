// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, act, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";

/**
 * 切出页面后音乐停止的修复。
 *
 * 线上现象：音乐播放时切到别的标签页 / 切到其他 App，过一会儿回来音乐就停了，
 * 再也不会自己响。
 *
 * 成因：浏览器与系统在页面进入后台一段时间后会自行暂停 <audio>（移动端省电、
 * 锁屏、Edge 效率模式），组件侧只收到一个 pause 事件；而 <audio> 的 onPause
 * 处理器把它当成「用户暂停」写进了 isPlaying —— 播放意图就此丢失，回到前台
 * 也没有任何逻辑把它拉起来。
 *
 * 修复分两半，这里各锁一条：
 * 1. useAudioPlayer：重新可见时，若播放意图仍在、音频却停着，就重新拉起；
 * 2. MusicPlayer：页面不可见时收到的 pause 不改写播放意图（源码契约，见文件末尾）。
 */

// jsdom 下 import.meta.url 不是 file: 协议，源码断言走 cwd 拼路径（vitest 从项目根运行）
const playerSource = readFileSync(
  join(process.cwd(), "components/home/MusicPlayer.tsx"),
  "utf8"
);

function Harness({ onApi }: { onApi: (api: ReturnType<typeof useAudioPlayer>) => void }) {
  const api = useAudioPlayer({
    songApi: "https://music.example.com",
    songServer: "netease",
    songId: "123",
    autoplay: true,
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

let api: ReturnType<typeof useAudioPlayer>;

/** 覆盖 audio.paused（jsdom 里它是原型上的只读 getter），模拟被系统暂停 / 仍在播放 */
function setPaused(audio: HTMLAudioElement, paused: boolean): void {
  Object.defineProperty(audio, "paused", { value: paused, configurable: true });
}

/** 派发一次「页面回到前台」 */
async function becomeVisible(): Promise<void> {
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

beforeEach(() => {
  localStorage.clear();
  // jsdom 未实现媒体控制，不打桩会在控制台刷 "Not implemented" 噪音
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useAudioPlayer · 回到前台恢复播放", () => {
  it("被系统在后台暂停后，重新可见时自动拉起", async () => {
    stubMusicFetch();
    render(
      <Harness
        onApi={(a) => {
          api = a;
        }}
      />
    );

    await waitFor(() => expect(api.isPlaying).toBe(true));
    const audio = document.querySelector("audio") as HTMLAudioElement;
    const before = vi.mocked(HTMLMediaElement.prototype.play).mock.calls.length;

    // 页面在后台：系统把音频停了（组件侧的 isPlaying 不变，因为 pause 来自系统）
    setPaused(audio, true);
    await becomeVisible();

    expect(
      vi.mocked(HTMLMediaElement.prototype.play).mock.calls.length,
      "回到前台却没有重新拉起，音乐从此一直静默"
    ).toBe(before + 1);
  });

  it("音频本来就在播时不重复拉起，避免打断", async () => {
    stubMusicFetch();
    render(
      <Harness
        onApi={(a) => {
          api = a;
        }}
      />
    );

    await waitFor(() => expect(api.isPlaying).toBe(true));
    const audio = document.querySelector("audio") as HTMLAudioElement;
    const before = vi.mocked(HTMLMediaElement.prototype.play).mock.calls.length;

    setPaused(audio, false);
    await becomeVisible();

    expect(vi.mocked(HTMLMediaElement.prototype.play).mock.calls.length).toBe(before);
  });

  it("访客主动暂停后回到前台不会自作主张续播", async () => {
    stubMusicFetch();
    render(
      <Harness
        onApi={(a) => {
          api = a;
        }}
      />
    );

    await waitFor(() => expect(api.isPlaying).toBe(true));
    const audio = document.querySelector("audio") as HTMLAudioElement;

    // 访客点了暂停
    await act(async () => {
      api.setIsPlaying(false);
    });
    const before = vi.mocked(HTMLMediaElement.prototype.play).mock.calls.length;

    setPaused(audio, true);
    await becomeVisible();

    expect(
      vi.mocked(HTMLMediaElement.prototype.play).mock.calls.length,
      "访客明确暂停过，回到前台不该再自动播放"
    ).toBe(before);
  });

  it("页面进入后台时不做任何暂停动作（不主动打断播放）", async () => {
    stubMusicFetch();
    render(
      <Harness
        onApi={(a) => {
          api = a;
        }}
      />
    );

    await waitFor(() => expect(api.isPlaying).toBe(true));
    const pause = vi.mocked(HTMLMediaElement.prototype.pause);
    pause.mockClear();

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    await becomeVisible();

    expect(pause, "进后台时主动暂停会把音乐掐断，正是要修的现象").not.toHaveBeenCalled();
  });
});

describe("MusicPlayer · 系统暂停不覆盖播放意图", () => {
  it("onPause 在页面不可见时提前返回，不改写 isPlaying", () => {
    // 组件层的内联处理器难以在 jsdom 里隔离触发，这里锁住关键分支：
    // 缺少 document.hidden 判断，后台暂停就会把播放意图抹掉
    const audioTag = playerSource.match(/<audio[\s\S]*?\/>/)?.[0] ?? "";
    expect(audioTag, "未找到常驻 <audio> 元素").toContain("onPause");
    expect(audioTag).toMatch(/if\s*\(\s*document\.hidden\s*\)\s*return/);
    expect(audioTag).toContain("setIsPlaying(false)");
  });

  it("把播放/暂停状态同步给系统媒体控制（锁屏 / 通知栏）", () => {
    // 系统知道这是活跃媒体后，更不容易被后台省电策略直接掐掉
    expect(playerSource).toMatch(/mediaSession\.playbackState\s*=/);
  });
});
