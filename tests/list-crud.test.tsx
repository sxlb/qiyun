import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { toast } from "sonner";
import {
  useListCrud,
  type CrudCounts,
  type UseListCrudOptions,
} from "@/components/admin/useListCrud";
import { GlobalSaveProvider } from "@/components/admin/GlobalSave";

/**
 * useListCrud：公告 / 作品 / 技能三个面板共用的列表数据层。
 *
 * 这三个面板自身没有组件测试，本文件直接锁住共享层的契约，避免以后改动
 * hook 时悄无声息地破坏三个面板的保存语义：
 * - 加载（成功 / 非 200）
 * - 增删改与脏标记
 * - 本地校验拦截（不发起请求）
 * - 仅提交通过过滤的行 + toPayload 转换
 * - 保存期间的并发编辑（修订号防竞态）
 * - 保存失败保留脏标记
 * - 响应缺少 list 时主动重取
 */

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

interface Row {
  id?: number;
  clientId?: number;
  title: string;
  sort: number;
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <GlobalSaveProvider>{children}</GlobalSaveProvider>
);

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

interface LoggedCall {
  url: string;
  method: string;
  body?: unknown;
}

/** 把 fetch 替换为可编排的路由器，并记录每次调用（含解析后的请求体） */
function mockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>
): LoggedCall[] {
  const calls: LoggedCall[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return handler(String(input), init);
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

function makeOptions(
  overrides: Partial<UseListCrudOptions<Row>> = {}
): UseListCrudOptions<Row> {
  return {
    id: "test-panel",
    label: "测试面板",
    api: "/api/test",
    makeEmpty: (index) => ({ title: "", sort: index }),
    isSubmittable: (it) => it.title.trim() !== "",
    successMessage: (c: CrudCounts) => `已保存：新增 ${c.createdCount}`,
    ...overrides,
  };
}

/** 渲染 hook 并等待首次加载结束 */
type CrudApi = ReturnType<typeof useListCrud<Row>>;
type View = { result: { current: CrudApi } };

async function renderLoaded(
  options: UseListCrudOptions<Row> = makeOptions()
): Promise<View> {
  const view = renderHook(() => useListCrud<Row>(options), { wrapper });
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  return view;
}

describe("useListCrud：加载", () => {
  beforeEach(() => vi.clearAllMocks());

  it("加载成功：GET 拉取列表、结束 loading、初始不脏", async () => {
    mockFetch(() => jsonResponse([{ id: 1, title: "A", sort: 0 }]));
    const { result } = await renderLoaded();

    expect(result.current.items).toEqual([{ id: 1, title: "A", sort: 0 }]);
    expect(result.current.dirty).toBe(false);
  });

  it("加载返回非 200：结束 loading、列表为空，并按 loadError 提示", async () => {
    mockFetch(() => jsonResponse({ error: "boom" }, false, 500));
    const { result } = await renderLoaded(makeOptions({ loadError: "加载失败" }));

    expect(result.current.items).toEqual([]);
    expect(toast.error).toHaveBeenCalledWith("加载失败");
  });
});

describe("useListCrud：增删改", () => {
  beforeEach(() => vi.clearAllMocks());

  it("addItem 写入递增排序值与互不相同的本地 id；removeItem 按下标删除", async () => {
    mockFetch(() => jsonResponse([]));
    const { result } = await renderLoaded();

    act(() => result.current.addItem());
    act(() => result.current.addItem());

    expect(result.current.items.map((it) => it.sort)).toEqual([0, 1]);
    const [first, second] = result.current.items.map((it) => it.clientId);
    expect(typeof first).toBe("number");
    expect(first).not.toBe(second);

    act(() => result.current.removeItem(0));
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].sort).toBe(1);
    expect(result.current.dirty).toBe(true);
  });

  it("update 改写指定行的字段并置脏", async () => {
    mockFetch(() => jsonResponse([{ id: 1, title: "A", sort: 0 }]));
    const { result } = await renderLoaded();

    act(() => result.current.update(0, "title", "B"));

    expect(result.current.items[0].title).toBe("B");
    expect(result.current.dirty).toBe(true);
  });
});

describe("useListCrud：保存", () => {
  beforeEach(() => vi.clearAllMocks());

  it("本地校验不通过：不发请求、返回 false、不置脏", async () => {
    const calls = mockFetch(() => jsonResponse([{ id: 1, title: "A", sort: 0 }]));
    const { result } = await renderLoaded(makeOptions({ validate: () => "标题不能为空" }));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.save();
    });

    expect(ok).toBe(false);
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(0);
    expect(result.current.dirty).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("标题不能为空");
  });

  it("仅提交通过过滤的行，并应用 toPayload 转换", async () => {
    const calls = mockFetch((_url, init) =>
      init?.method === "PUT"
        ? jsonResponse({
            list: [{ id: 7, title: "完整行", sort: 0 }],
            createdCount: 1,
            updatedCount: 0,
            deletedCount: 0,
          })
        : jsonResponse([
            { id: 7, title: "完整行", sort: 0 },
            { id: 8, title: "   ", sort: 1 },
          ])
    );
    const { result } = await renderLoaded(
      makeOptions({ toPayload: (it) => ({ title: it.title.trim(), order: it.sort }) })
    );

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.save();
    });

    expect(ok).toBe(true);
    const put = calls.find((c) => c.method === "PUT");
    // 空白标题行被 isSubmittable 过滤，且已按 toPayload 转换
    expect(put?.body).toEqual([{ title: "完整行", order: 0 }]);
    // 保存成功后应用服务端返回值并清脏
    expect(result.current.items).toEqual([{ id: 7, title: "完整行", sort: 0 }]);
    expect(result.current.dirty).toBe(false);
    expect(toast.success).toHaveBeenCalledWith("已保存：新增 1");
  });

  it("保存期间又有新改动：保留本地输入与脏标记，不被服务端结果覆盖", async () => {
    let resolvePut: ((res: Response) => void) | undefined;
    const calls = mockFetch((_url, init) => {
      if (init?.method === "PUT") {
        return new Promise<Response>((resolve) => {
          resolvePut = resolve;
        });
      }
      return jsonResponse([{ id: 1, title: "A", sort: 0 }]);
    });
    const { result } = await renderLoaded();

    let savePromise: Promise<boolean> | undefined;
    await act(async () => {
      savePromise = result.current.save();
      // 请求在途，用户继续编辑
      result.current.update(0, "title", "改动中的标题");
    });
    expect(result.current.saving).toBe(true);

    await act(async () => {
      resolvePut?.(
        jsonResponse({
          list: [{ id: 1, title: "服务端旧值", sort: 0 }],
          createdCount: 0,
          updatedCount: 1,
          deletedCount: 0,
        })
      );
      await savePromise;
    });

    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1);
    // 关键断言：本地新改动没被服务端旧值覆盖，脏标记保留，并给了提示
    expect(result.current.items[0].title).toBe("改动中的标题");
    expect(result.current.dirty).toBe(true);
    expect(toast.warning).toHaveBeenCalled();
  });

  it("保存失败（非 200）：返回 false 且保留脏标记与本地输入", async () => {
    mockFetch((_url, init) =>
      init?.method === "PUT"
        ? jsonResponse({ error: "服务端炸了" }, false, 500)
        : jsonResponse([{ id: 1, title: "A", sort: 0 }])
    );
    const { result } = await renderLoaded();

    act(() => result.current.update(0, "title", "B"));
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.save();
    });

    expect(ok).toBe(false);
    expect(result.current.dirty).toBe(true);
    expect(result.current.items[0].title).toBe("B");
    expect(toast.error).toHaveBeenCalledWith("服务端炸了");
  });

  it("响应缺少 list：保存后主动重取列表，避免本地与服务端漂移", async () => {
    let getCount = 0;
    mockFetch((_url, init) => {
      if (init?.method === "PUT") {
        return jsonResponse({ createdCount: 1, updatedCount: 0, deletedCount: 0 });
      }
      getCount += 1;
      return jsonResponse([{ id: 9, title: `第${getCount}次拉取`, sort: 0 }]);
    });
    const { result } = await renderLoaded();

    await act(async () => {
      await result.current.save();
    });

    await waitFor(() => expect(result.current.items[0]?.title).toBe("第2次拉取"));
    expect(getCount).toBe(2);
    expect(result.current.dirty).toBe(false);
  });
});
