import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { toast } from "sonner";
import { useDataFetcher } from "@/components/admin/useDataFetcher";

/**
 * useDataFetcher：健康检测 / 媒体库 / 操作日志三个面板共用的拉取层。
 *
 * 这三个面板没有组件测试，本文件直接锁住共享层契约，重点是那条最容易被改坏的
 * 不变量 —— **过期响应必须被丢弃**（连点刷新 / 快速翻页时，先发的旧响应
 * 不能覆盖后发的新数据）。
 */

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

/** 从请求 URL 上取一个整数参数，便于按参数分辨是哪一次请求 */
function pageOf(input: RequestInfo | URL): number {
  return Number(new URL(String(input), "http://localhost").searchParams.get("page"));
}

describe("useDataFetcher：初始加载", () => {
  beforeEach(() => vi.clearAllMocks());

  it("传入 initialArgs：挂载自动请求一次并写入 data", async () => {
    const fn = vi.fn(async () => jsonResponse({ v: 1 }));
    vi.stubGlobal("fetch", fn);

    const { result } = renderHook(() =>
      useDataFetcher<{ v: number }>(() => fetch("/api/x"), { initialArgs: [] })
    );

    await waitFor(() => expect(result.current.data).toEqual({ v: 1 }));
    expect(result.current.loading).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("不传 initialArgs：不自动请求，由调用方自行 run", async () => {
    const fn = vi.fn(async () => jsonResponse({ v: 1 }));
    vi.stubGlobal("fetch", fn);

    const { result } = renderHook(() => useDataFetcher<{ v: number }>(() => fetch("/api/x")));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(fn).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });
});

describe("useDataFetcher：竞态与错误", () => {
  beforeEach(() => vi.clearAllMocks());

  it("过期响应被丢弃：先发的旧请求后返回也不覆盖新数据", async () => {
    const pending = new Map<number, (res: Response) => void>();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (input: RequestInfo | URL) =>
          new Promise<Response>((resolve) => pending.set(pageOf(input), resolve))
      )
    );

    const { result } = renderHook(() =>
      useDataFetcher<{ page: number }, [number]>((page) => fetch(`/api/list?page=${page}`))
    );

    let newer: Promise<{ page: number } | null> | undefined;
    await act(async () => {
      void result.current.run(2); // 旧请求：先发出，最后才返回
      newer = result.current.run(3); // 新请求
    });

    await act(async () => {
      pending.get(3)?.(jsonResponse({ page: 3 }));
      await newer;
    });
    expect(result.current.data).toEqual({ page: 3 });

    // 放行最早的旧请求
    await act(async () => {
      pending.get(2)?.(jsonResponse({ page: 2 }));
    });

    expect(result.current.data).toEqual({ page: 3 });
    expect(result.current.loading).toBe(false);
  });

  it("响应非 2xx：按 notOkMessage 提示，且不写入 data", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "x" }, false, 500)));

    const { result } = renderHook(() =>
      useDataFetcher<{ v: number }>(() => fetch("/api/x"), { notOkMessage: "加载失败啦" })
    );

    await act(async () => {
      await result.current.run();
    });

    expect(toast.error).toHaveBeenCalledWith("加载失败啦");
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("notOkMessage 传 null：非 2xx 静默不提示", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "x" }, false, 500)));

    const { result } = renderHook(() =>
      useDataFetcher<{ v: number }>(() => fetch("/api/x"), { notOkMessage: null })
    );

    await act(async () => {
      await result.current.run();
    });

    expect(toast.error).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
  });

  it("网络异常：按 networkMessage 提示", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("boom");
      })
    );

    const { result } = renderHook(() =>
      useDataFetcher<{ v: number }>(() => fetch("/api/x"), { networkMessage: "网络炸了" })
    );

    await act(async () => {
      await result.current.run();
    });

    expect(toast.error).toHaveBeenCalledWith("网络炸了");
  });

  it("卸载后响应才返回：不抛异常（守卫已生效）", async () => {
    let resolveFetch: ((res: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          })
      )
    );

    const { result, unmount } = renderHook(() => useDataFetcher<{ v: number }>(() => fetch("/api/x")));

    await act(async () => {
      void result.current.run();
    });
    unmount();

    await act(async () => {
      resolveFetch?.(jsonResponse({ v: 1 }));
    });

    // 无异常即通过：卸载后不再 setState / 不再弹提示
    expect(toast.error).not.toHaveBeenCalled();
  });
});
