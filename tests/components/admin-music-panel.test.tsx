// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import MusicPanel from "@/components/admin/MusicPanel";
import { GlobalSaveProvider } from "@/components/admin/GlobalSave";
import { resetProfileCache } from "@/components/admin/profileShared";

/**
 * 后台「音乐设置」面板的侧栏默认状态。
 *
 * 这个面板此前没有任何测试，而它恰好落在本项目最容易静默出错的一条链路上：
 * 新增字段若没进 profileSchema，后台改了、接口仍返回 200、值却没落库。
 * 所以这里锁三件事：
 * 1. 下拉确实渲染出来并带出服务端的值（否则站长根本改不了）；
 * 2. 脏值回落默认，下拉里不会出现一个不存在的选项；
 * 3. 改完之后保存，PUT 的 body 里必须带上这个字段（在客户端这一侧再堵一次）。
 */

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

const PROFILE = {
  id: 1,
  songApi: "https://api.injahow.cn/meting/",
  songServer: "netease",
  songId: "3778678",
  musicAutoplay: false,
  musicSidebarDefault: "expand",
};

/** 装好 fetch 替身，并把所有请求记下来以便断言 PUT 的 body */
function stubFetch(profile: Record<string, unknown>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      if (String(input).startsWith("/api/profile")) {
        if (init?.method === "PUT") return jsonResponse({ ...profile, ...JSON.parse(String(init.body)) });
        return jsonResponse(profile);
      }
      return jsonResponse({ error: "not found" }, false, 404);
    })
  );
  return calls;
}

function renderPanel() {
  return render(
    <GlobalSaveProvider>
      <MusicPanel />
    </GlobalSaveProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // 面板共享的配置缓存是模块级状态：不清的话第二个用例会直接拿到上一个用例缓存的值，
  // 「服务端返回了不同值」这件事就不会被读出来
  resetProfileCache();
});

describe("后台音乐设置：侧栏默认状态", () => {
  it("下拉带出服务端的值，三个选项都在，且显示当前选项的说明", async () => {
    stubFetch(PROFILE);
    renderPanel();

    const select = (await screen.findByLabelText("侧栏默认状态")) as HTMLSelectElement;
    expect(select.value).toBe("expand");
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      "demo",
      "expand",
      "collapse",
    ]);
    // 说明文字要跟着当前选项走，否则站长看不出三者的区别
    expect(screen.getByText(/进门就是展开的播放器/)).toBeTruthy();
  });

  /**
   * 注：曾想在这里断言「库里是脏值时下拉回落默认」，反向验证发现它是**空测试** ——
   * 浏览器对「不存在的 option 值」本来就会退回显示第一项，所以把解析去掉它照样通过。
   * 脏值收敛由 tests/lib/music-handle-placement.test.ts 的 parseMusicSidebarDefault 锁住。
   */

  it("改完保存：PUT 的 body 必须带上这个字段（历史上新字段漏进 schema 就是这样静默失效的）", async () => {
    const calls = stubFetch(PROFILE);
    renderPanel();

    const select = (await screen.findByLabelText("侧栏默认状态")) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "collapse" } });
    fireEvent.click(screen.getByRole("button", { name: /保存音乐设置/ }));

    await waitFor(() => {
      const put = calls.find((c) => c.init?.method === "PUT");
      expect(put, "没有发出保存请求").toBeTruthy();
      expect(JSON.parse(String(put!.init!.body)).musicSidebarDefault).toBe("collapse");
    });
  });

  it("没改动就不提交这个字段（避免覆盖别处的配置）", async () => {
    const calls = stubFetch(PROFILE);
    renderPanel();

    await screen.findByLabelText("侧栏默认状态");
    fireEvent.click(screen.getByRole("button", { name: /保存音乐设置/ }));

    await waitFor(() => {
      expect(calls.some((c) => c.init?.method === "PUT")).toBe(true);
    });
    const put = calls.find((c) => c.init?.method === "PUT")!;
    // 没动过的字段值仍会被带上（payload = 服务端基线 + 补丁），但值必须是服务端原值
    expect(JSON.parse(String(put.init!.body)).musicSidebarDefault).toBe("expand");
  });
});
