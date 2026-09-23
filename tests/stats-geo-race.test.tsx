import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import StatsPanel from "@/components/admin/StatsPanel";

/**
 * 访客地域卡片的时间范围切换竞态。
 *
 * 背景：GeoRankCard 随「全部 / 近 7 天 / 近 30 天 / 近 90 天」切换重新请求，
 * 但原实现只有「卸载守卫」（cancelled）而没有「请求序号守卫」。快速连点两个范围时，
 * 先发出的旧请求可能后返回，把新范围的数据覆盖掉 —— 界面会出现
 * 「高亮的是近 30 天、显示的却是近 7 天的数据」这种自相矛盾的状态。
 *
 * 本文件用「先挂起旧请求、再放行」的方式稳定复现该竞态。
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

/** 主看板最小可用数据（未提供的字段组件均有条件守卫） */
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

function geoResp(region: string) {
  return {
    list: [{ region, visits: 1, ips: 1 }],
    totalVisits: 1,
    sampled: 1,
  };
}

describe("StatsPanel：访客地域时间范围切换的竞态", () => {
  beforeEach(() => vi.clearAllMocks());

  it("旧请求后返回时被丢弃，不覆盖新范围的数据", async () => {
    // 挂起的 days=7 请求：由测试在最后手动放行
    const pending = new Map<string, (res: Response) => void>();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/api/stats/dashboard")) return jsonResponse(DASHBOARD);
        if (url.includes("days=30")) return jsonResponse(geoResp("三十天省"));
        if (url.includes("days=7")) {
          return new Promise<Response>((resolve) => pending.set("7", resolve));
        }
        return jsonResponse(geoResp("全部省"));
      })
    );

    const user = userEvent.setup();
    render(<StatsPanel />);

    // 等主看板加载完成
    await screen.findByText("今日 PV");
    expect(await screen.findByText("全部省")).toBeTruthy();

    // 连点两个范围：近 7 天（挂起）+ 近 30 天（立即返回）
    await user.click(screen.getByRole("button", { name: "近 7 天" }));
    await user.click(screen.getByRole("button", { name: "近 30 天" }));
    expect(await screen.findByText("三十天省")).toBeTruthy();

    // 现在放行最早那个 days=7 的请求 —— 它已过期，不得覆盖当前范围
    await act(async () => {
      pending.get("7")?.(jsonResponse(geoResp("七天省")));
    });

    expect(screen.queryByText("七天省")).toBeNull();
    expect(screen.getByText("三十天省")).toBeTruthy();
  });
});
