// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import LinksPanel from "@/components/admin/LinksPanel";
import { GlobalSaveProvider } from "@/components/admin/GlobalSave";

/**
 * 社交链接面板的「推荐数量」提示。
 *
 * 首页左栏的社交胶囊按标签长度折行：数量一多就折成多行、左栏变高，
 * 矮屏上要看全就得滚动。提示只在社交链接面板出现（showTip），
 * 网站/友链面板不显示 —— 那两个本来就是列表，多几行不碍事。
 */

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function makeLinks(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    name: `站点${i + 1}`,
    icon: "globe",
    url: `https://example.com/${i + 1}`,
    tip: "",
    sort: i,
  }));
}

function renderPanel({ showTip, count }: { showTip: boolean; count: number }) {
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(makeLinks(count))));
  return render(
    <GlobalSaveProvider>
      <LinksPanel
        apiPath="/api/social-links"
        emptyText="暂无链接"
        successMessage="已保存"
        showTip={showTip}
      />
    </GlobalSaveProvider>
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("社交链接推荐数量提示", () => {
  it("社交链接面板（showTip）显示推荐 3 到 6 个 / 折行说明", async () => {
    renderPanel({ showTip: true, count: 1 });
    const tip = await screen.findByText(/推荐 3 到 6 个/);
    expect(tip.textContent).toContain("折成多行");
    // 1 个在推荐区间内：只报数量，不给精简建议
    expect(screen.getByText(/当前 1 个/)).toBeTruthy();
    expect(screen.queryByText(/建议精简一些/)).toBeNull();
  });

  it("数量超过推荐上限时给出精简建议并转警示色", async () => {
    renderPanel({ showTip: true, count: 7 });
    await waitFor(() => expect(screen.getByText(/当前 7 个/)).toBeTruthy());
    const warn = screen.getByText(/当前 7 个/);
    expect(warn.textContent).toContain("建议精简一些");
    expect(warn.className).toContain("text-amber");
  });

  it("网站/友链面板（不传 showTip）不显示该提示", () => {
    renderPanel({ showTip: false, count: 7 });
    expect(screen.queryByText(/推荐 3 到 6 个/)).toBeNull();
    expect(screen.queryByText(/当前 7 个/)).toBeNull();
  });
});
