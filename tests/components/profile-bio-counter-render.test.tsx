// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import ProfilePanel from "@/components/admin/ProfilePanel";
import { GlobalSaveProvider } from "@/components/admin/GlobalSave";
import { BIO_MAX_LENGTH } from "@/lib/validation";

/**
 * 个性签名计数器的**真实渲染**回归。
 *
 * 背景：最初只测了配色函数 bioCounterClass，那只能证明「配色对不对」，证明不了
 * 「计数器有没有出现在页面上」。这一条锁住渲染结果本身 —— 计数器必须真的渲染出来，
 * 且必须和输入框处在同一个字段块内（否则「提示挂在哪」无人保证）。
 */

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

beforeEach(() => {
  // 只关心计数器渲染，接口回一份最小配置即可（其余字段由默认值补齐）
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ bio: "abc" })));
});

afterEach(() => vi.unstubAllGlobals());

describe("个性签名计数器渲染", () => {
  it("渲染出「已用 / 上限」，且与输入框同属一个字段块", async () => {
    render(
      <GlobalSaveProvider>
        <ProfilePanel />
      </GlobalSaveProvider>
    );

    const counter = await screen.findByText(`3 / ${BIO_MAX_LENGTH}`);
    expect(counter).toBeTruthy();

    const textarea = document.getElementById("bio");
    expect(textarea).toBeTruthy();
    // 同属一个 div.space-y-2：计数器是文本域所在字段块的一部分
    expect(textarea!.parentElement?.textContent).toContain(`3 / ${BIO_MAX_LENGTH}`);
  });
});
