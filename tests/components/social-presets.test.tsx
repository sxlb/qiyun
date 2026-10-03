// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import LinksManager from "@/components/admin/LinksManager";
import { GlobalSaveProvider } from "@/components/admin/GlobalSave";
import { SOCIAL_PRESETS } from "@/lib/social-presets";

/**
 * 社交链接的「常用平台一键预设」。
 *
 * 目的：新增社交链接原本要手填名称 / 图标 / 地址三个字段，而图标取值格式有四种
 * （lucide 名、Iconify prefix:name、图片 URL、内联 SVG），逐个回忆成本高。
 * 预设点一下就生成填好的行，这里锁住「点一次即预填正确」这个行为。
 */

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

function mockFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/social-links")) {
        return (init?.method ?? "GET") === "PUT" ? jsonResponse({ list: [] }) : jsonResponse([]);
      }
      return jsonResponse({ error: "not found" }, false, 404);
    })
  );
}

async function renderManager() {
  render(
    <GlobalSaveProvider>
      <LinksManager />
    </GlobalSaveProvider>
  );
  // 等首个面板加载完成（加载态结束后才出现「添加链接」）
  await screen.findByRole("button", { name: /添加链接/ });
}

describe("社交链接常用平台预设", () => {
  beforeEach(() => vi.clearAllMocks());

  it("渲染全部常用平台快捷入口", async () => {
    mockFetch();
    await renderManager();

    for (const preset of SOCIAL_PRESETS) {
      expect(screen.getByRole("button", { name: `+ ${preset.name}` })).toBeTruthy();
    }
  });

  it("预设清单本身自洽：名称唯一、图标非空、地址前缀符合链接校验规则", () => {
    const names = SOCIAL_PRESETS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);

    for (const preset of SOCIAL_PRESETS) {
      expect(preset.icon.trim()).not.toBe("");
      // 地址前缀要么留空，要么能以合法协议开头（后台链接校验：http(s)/mailto/tel/music）
      if (preset.urlPrefix) {
        expect(preset.urlPrefix).toMatch(/^(https?:\/\/|mailto:|tel:|music:)/);
      }
    }
  });

  it("点击预设即生成填好名称 / 图标 / 地址前缀的行，并自动展开", async () => {
    mockFetch();
    const user = userEvent.setup();
    await renderManager();

    await user.click(screen.getByRole("button", { name: "+ GitHub" }));

    expect((screen.getByLabelText("名称") as HTMLInputElement).value).toBe("GitHub");
    expect((screen.getByLabelText("图标") as HTMLInputElement).value).toBe("simple-icons:github");
    expect((screen.getByLabelText("链接地址") as HTMLInputElement).value).toBe("https://github.com/");
    // 社交链接独有的悬停提示也应一并预填
    expect((screen.getByLabelText("悬停提示") as HTMLInputElement).value).toBe("去 GitHub 看看");
  });

  it("地址前缀为 mailto: 的预设同样可用", async () => {
    mockFetch();
    const user = userEvent.setup();
    await renderManager();

    await user.click(screen.getByRole("button", { name: "+ 邮箱" }));

    expect((screen.getByLabelText("名称") as HTMLInputElement).value).toBe("邮箱");
    expect((screen.getByLabelText("图标") as HTMLInputElement).value).toBe("lucide:mail");
    expect((screen.getByLabelText("链接地址") as HTMLInputElement).value).toBe("mailto:");
  });
});
