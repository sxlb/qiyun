import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import LinksManager from "@/components/admin/LinksManager";
import { GlobalSaveFab, GlobalSaveProvider } from "@/components/admin/GlobalSave";

/**
 * 链接面板的「全局保存」注册唯一性。
 *
 * 背景：useLinkList 已自行把每个链接面板注册进 GlobalSave；若外层容器
 * （LinksManager）再注册一层转发，一次「保存全部修改」会对
 * 同一个面板重复调用 save()，导致重复 PUT（并重复写操作日志），且容器那层
 * 的脏标记无人清除、悬浮按钮永远不消失。
 *
 * 本文件锁住「一个面板只注册一次」这个不变量。
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

interface LoggedCall {
  url: string;
  method: string;
}

/** 只关心链接接口；其余请求一律 404，避免测试意外依赖别的端点 */
function mockFetch(): LoggedCall[] {
  const calls: LoggedCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method });
      if (url.startsWith("/api/social-links")) {
        return method === "PUT"
          ? jsonResponse({ list: [], createdCount: 1, updatedCount: 0, deletedCount: 0 })
          : jsonResponse([]);
      }
      return jsonResponse({ error: "not found" }, false, 404);
    })
  );
  return calls;
}

/** 悬浮保存按钮（有未保存改动时才存在） */
function fab(): HTMLElement | null {
  return document.querySelector('button[aria-label^="保存全部修改"]');
}

/** 悬浮按钮上显示的「待保存面板数」（唯一那个计数 span） */
function fabCount(): string | null {
  return fab()?.querySelector("span")?.textContent ?? null;
}

/** 等待异步保存流程彻底结束（jsdom 内 fetch 为微任务，无需真实等待太久） */
async function settle(ms = 200) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

async function renderManager(): Promise<LoggedCall[]> {
  const calls = mockFetch();
  render(
    <GlobalSaveProvider>
      <LinksManager />
      <GlobalSaveFab />
    </GlobalSaveProvider>
  );
  // 等首个子面板加载完成（加载态结束后才出现「添加链接」）
  await screen.findByRole("button", { name: /添加链接/ });
  return calls;
}

describe("链接面板的全局保存注册", () => {
  beforeEach(() => vi.clearAllMocks());

  it("单个链接面板变脏时，悬浮按钮只计 1 个面板", async () => {
    const user = userEvent.setup();
    await renderManager();
    expect(fab()).toBeNull();

    await user.click(screen.getByRole("button", { name: /添加链接/ }));

    await waitFor(() => expect(fab()).not.toBeNull());
    expect(fabCount()).toBe("1");
  });

  it("保存全部：同一面板只发起一次 PUT，且保存完成后不残留脏状态", async () => {
    const user = userEvent.setup();
    const calls = await renderManager();

    await user.click(screen.getByRole("button", { name: /添加链接/ }));
    await waitFor(() => expect(fab()).not.toBeNull());

    await user.click(fab()!);
    await settle();

    // 重复注册时这里会是 2
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1);
    // 重复注册时容器那层脏标记无人清除，按钮会一直挂着
    expect(fab()).toBeNull();
  });
});
