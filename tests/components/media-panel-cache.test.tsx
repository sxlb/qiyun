// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import MediaPanel from "@/components/admin/MediaPanel";

/**
 * 媒体库里的「壁纸缓存」分区。
 *
 * 这块与媒体库共用同一个面板但数据源不同（manifest vs ImageAsset），
 * 这里锁住三件容易接线接错的事：汇总数据来自 /api/wallpaper/cache、默认折叠、
 * 删除时带的是 fileName 而不是媒体库的 id。
 */

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

const CACHE = {
  items: [
    {
      fileName: "abc.webp",
      url: "/api/wallpaper/file/abc.webp",
      sourceUrl: "https://example.com/abc.webp",
      addedAt: 1,
      size: 2048,
      tag: "anime:pc",
      exists: true,
    },
  ],
  total: 1,
  bytes: 2048,
  max: 100,
  readyThreshold: 5,
  budgets: [
    { key: "pc", label: "电脑", count: 1, max: 100, bytes: 2048 },
    { key: "mobile", label: "手机", count: 0, max: 100, bytes: 0 },
    { key: "shared", label: "必应共享", count: 0, max: 100, bytes: 0 },
  ],
};

/** 记录请求，便于断言删除时用的是哪个地址 */
const requests: string[] = [];

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  requests.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push(`${init?.method ?? "GET"} ${url}`);
      if (url.startsWith("/api/wallpaper/cache")) {
        if (init?.method === "DELETE") return jsonResponse({ ok: true, removed: 1 });
        return jsonResponse(CACHE);
      }
      if (url.startsWith("/api/media")) return jsonResponse({ items: [], total: 0, page: 1 });
      return jsonResponse({ error: "not found" }, false, 404);
    })
  );
});

describe("媒体库 · 壁纸缓存分区", () => {
  it("展示缓存张数与占用，且默认折叠不渲染缩略图", async () => {
    render(<MediaPanel />);

    expect(await screen.findByText(/已缓存 1 张/)).toBeTruthy();
    expect(screen.getByText(/占用 2\.0 KB/)).toBeTruthy();
    // 额度分三份（电脑 / 手机 / 必应共享），说明文案要讲清楚「各自填满即停止新增」
    expect(screen.getByText(/电脑 100 张/)).toBeTruthy();
    expect(screen.getByText(/各自填满即停止新增/)).toBeTruthy();
    // 用量必须按预算组渲染出来：最容易出现「接口有数据但界面没展示」
    expect(screen.getByText(/电脑 1\/100/)).toBeTruthy();
    expect(screen.getByText(/手机 0\/100/)).toBeTruthy();

    // 默认折叠：折叠时不该渲染缓存图片
    expect(screen.queryByAltText("abc.webp")).toBeNull();
    expect(screen.getByRole("button", { name: /展开查看/ })).toBeTruthy();
  });

  it("展开后列出缓存项，删除时按 fileName 请求", async () => {
    const user = userEvent.setup();
    render(<MediaPanel />);
    await screen.findByText(/已缓存 1 张/);

    await user.click(screen.getByRole("button", { name: /展开查看/ }));
    expect(screen.getByAltText("abc.webp")).toBeTruthy();

    // 两段式确认，避免误触
    await user.click(screen.getByRole("button", { name: /^删除$/ }));
    await user.click(screen.getByRole("button", { name: /确认删除/ }));

    expect(requests).toContain("DELETE /api/wallpaper/cache?fileName=abc.webp");
  });

  it("清空需要二次确认，且请求带上 all=1", async () => {
    const user = userEvent.setup();
    render(<MediaPanel />);
    await screen.findByText(/已缓存 1 张/);

    await user.click(screen.getByRole("button", { name: /^清空$/ }));
    // 未确认前不应发请求
    expect(requests.some((r) => r.includes("all=1"))).toBe(false);

    await user.click(screen.getByRole("button", { name: /确认清空/ }));
    expect(requests).toContain("DELETE /api/wallpaper/cache?all=1");
  });
});
