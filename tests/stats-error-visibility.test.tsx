import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { toast } from "sonner";
import StatsPanel from "@/components/admin/StatsPanel";

/**
 * 统计面板的错误可见性。
 *
 * 背景：StatsPanel 主看板与「访客地域」卡片此前把失败分成两半处理：
 * - 网络异常：主看板会 toast，地域卡片**完全静默**；
 * - 响应非 2xx：两者都**静默**（`r.ok ? r.json() : null` 把失败变成了空数据）。
 *
 * 结果是请求失败时页面只是「数字全 0 / 暂无地域数据」，用户无法区分
 * 「确实没有访客」和「请求挂了」。本文件锁住「失败必须可见」这条不变量。
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

/** 主看板成功响应（未提供的字段组件均有条件守卫） */
const DASHBOARD = {
  totalPv: 0,
  totalUv: 0,
  todayPv: 0,
  todayUv: 0,
  yesterdayPv: 0,
  yesterdayUv: 0,
  daily: [],
  referrers: [],
  sourceBuckets: [],
  devices: [],
  os: [],
  browsers: [],
  hours: [],
  onlineNow: 0,
  topLinks: [],
};

const EMPTY_GEO = { list: [], totalVisits: 0, sampled: 0 };

/** 按 URL 路由 fetch；geo 的行为由参数决定 */
function routeFetch(geo: () => Response | Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/stats/dashboard")) return jsonResponse(DASHBOARD);
      if (url.startsWith("/api/stats/geo")) return geo();
      return jsonResponse({}, false, 404);
    })
  );
}

describe("StatsPanel：失败必须可见", () => {
  beforeEach(() => vi.clearAllMocks());

  it("主看板返回非 2xx：给出错误提示，而不是静默显示全 0", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/api/stats/dashboard")) return jsonResponse({ error: "x" }, false, 500);
        return jsonResponse(EMPTY_GEO);
      })
    );

    render(<StatsPanel />);

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith("加载统计数据失败"));
  });

  it("地域卡片网络异常：给出错误提示，而不是静默显示「暂无地域数据」", async () => {
    routeFetch(() => {
      throw new Error("network down");
    });

    render(<StatsPanel />);

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith("加载地域数据失败"));
  });

  it("地域卡片返回非 2xx：同样给出错误提示", async () => {
    routeFetch(() => jsonResponse({ error: "x" }, false, 500));

    render(<StatsPanel />);

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith("加载地域数据失败"));
  });

  it("全部成功时不弹任何错误提示（避免误报）", async () => {
    routeFetch(() => jsonResponse(EMPTY_GEO));

    render(<StatsPanel />);

    await screen.findByText("今日 PV");
    await screen.findByText("访客地域省份 TOP");
    expect(toast.error).not.toHaveBeenCalled();
  });
});
