// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import LinksPanel from "@/components/admin/LinksPanel";
import { GlobalSaveProvider } from "@/components/admin/GlobalSave";
import { toast } from "sonner";

/**
 * 后台社交链接的「点击弹出图片」字段（微信 / QQ 这类没有可跳转主页的平台）。
 *
 * 这里锁三件事：
 * 1. 该字段只在社交链接面板出现 —— 网站/友链面板的接口没有这一列，多显示一个框只会误导；
 * 2. 「链接地址与弹出图片至少填一项」要真的能拦住保存（这条规则是页面侧无法兜底的：
 *    两个都空的条目在前台点了没有任何反应）；
 * 3. 只填二维码、地址留空时能存下去，且提交的 url 是空串而不是被丢掉。
 */

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 400, json: async () => body } as unknown as Response;
}

interface LoggedCall {
  url: string;
  method: string;
  body: unknown;
}

function mockFetch(items: unknown[] = []): LoggedCall[] {
  const calls: LoggedCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url, method, body });
      if (method === "PUT") {
        return jsonResponse({ list: [], createdCount: 1, updatedCount: 0, deletedCount: 0 });
      }
      return jsonResponse(items);
    })
  );
  return calls;
}

async function renderPanel({ showTip, items = [] }: { showTip: boolean; items?: unknown[] }) {
  const calls = mockFetch(items);
  render(
    <GlobalSaveProvider>
      <LinksPanel
        apiPath="/api/social-links"
        emptyText="暂无链接"
        successMessage="已保存"
        tabLabel="社交链接"
        showTip={showTip}
      />
    </GlobalSaveProvider>
  );
  await screen.findByRole("button", { name: /添加链接/ });
  return calls;
}

/** 新增一行并展开（展开态下才有全部字段） */
async function addRow(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /添加链接/ }));
  await screen.findByLabelText("名称");
}

function saveButton() {
  return screen.getByRole("button", { name: "保存社交链接" });
}

beforeEach(() => vi.clearAllMocks());

describe("社交链接的「点击弹出图片」字段", () => {
  it("社交链接面板提供该字段与上传入口", async () => {
    const user = userEvent.setup();
    await renderPanel({ showTip: true });
    await addRow(user);

    expect(document.getElementById("link-popup-0")).not.toBeNull();
    expect(screen.getByRole("button", { name: /上传二维码/ })).toBeTruthy();
  });

  it("网站链接面板不提供该字段（接口没有这一列）", async () => {
    const user = userEvent.setup();
    await renderPanel({ showTip: false });
    await addRow(user);

    expect(document.getElementById("link-popup-0")).toBeNull();
    expect(screen.queryByRole("button", { name: /上传二维码/ })).toBeNull();
  });

  it("地址与弹出图片都为空时拦住保存，并给出定位到行的提示", async () => {
    const user = userEvent.setup();
    const calls = await renderPanel({ showTip: true });
    await addRow(user);
    await user.type(screen.getByLabelText("名称"), "微信");

    await user.click(saveButton());

    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("至少填一项"));
    // 校验没过就不该发请求
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(0);
  });

  it("只填二维码、地址留空时可以保存，且 url 以空串提交", async () => {
    const user = userEvent.setup();
    const calls = await renderPanel({ showTip: true });
    await addRow(user);
    await user.type(screen.getByLabelText("名称"), "微信");
    await user.type(document.getElementById("link-popup-0")!, "/api/uploads/file/qr.png");

    await user.click(saveButton());

    const puts = calls.filter((c) => c.method === "PUT");
    expect(puts).toHaveLength(1);
    const payload = puts[0].body as { url: string; popupImage: string }[];
    expect(payload[0].popupImage).toBe("/api/uploads/file/qr.png");
    expect(payload[0].url).toBe("");
  });
});
