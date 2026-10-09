// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWeatherShared, resetWeatherShare } from "@/lib/weatherClient";

/**
 * 前端天气取数的共享层：首页两处（时钟天气胶囊 + 欢迎通知）共用同一次请求。
 *
 * 锁住四件事：
 * 1. 并发调用只发一次请求 —— 这正是引入共享层的目的
 * 2. 成功结果短时复用，但窗口远短于胶囊 10 分钟的重取间隔，不会展示过期天气
 * 3. **失败结果不缓存** —— 缓存住失败会让后续调用者连重试的机会都没有
 * 4. 永不抛异常（调用方不必包 try/catch），且超时不冒充"网络错误"
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  resetWeatherShare();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("fetchWeatherShared", () => {
  it("并发调用只发一次请求（两个组件同时挂载的场景）", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ city: "深圳市", region: "广东省 深圳市" }));
    vi.stubGlobal("fetch", fetchMock);

    const [a, b] = await Promise.all([fetchWeatherShared(), fetchWeatherShared()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a.data?.region).toBe("广东省 深圳市");
    expect(b.data?.region).toBe("广东省 深圳市");
  });

  it("先后调用复用同一份成功结果，不再打接口", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ city: "深圳市" }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchWeatherShared();
    await fetchWeatherShared();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("超出复用窗口后重新请求", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const fetchMock = vi.fn(async () => jsonResponse({ city: "深圳市" }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchWeatherShared();
    vi.setSystemTime(Date.now() + 61_000);
    await fetchWeatherShared();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("失败结果不缓存：下一次调用会重试并拿到数据", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? jsonResponse({ error: "未配置天气数据源" }, 400) : jsonResponse({ city: "深圳市" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await fetchWeatherShared();
    expect(first.data).toBeNull();
    expect(first.error).toBe("天气数据获取失败");

    const second = await fetchWeatherShared();
    expect(second.data).toEqual({ city: "深圳市" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("网络异常返回 error，不抛异常", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("boom");
      })
    );

    const r = await fetchWeatherShared();

    expect(r.data).toBeNull();
    expect(r.error).toBe("网络错误");
  });

  it("超时（AbortError）不算错误：与共享化之前的胶囊行为一致", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const e = new Error("aborted");
        e.name = "AbortError";
        throw e;
      })
    );

    const r = await fetchWeatherShared();

    expect(r.data).toBeNull();
    expect(r.error).toBeUndefined();
  });

  it("失败之后再成功后，成功结果会被复用（错误不会把缓存卡死）", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? jsonResponse({}, 500) : jsonResponse({ city: "深圳市" });
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchWeatherShared();
    await fetchWeatherShared();
    await fetchWeatherShared();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
