// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ExternalApiPanel from "@/components/admin/ExternalApiPanel";
import { GlobalSaveProvider } from "@/components/admin/GlobalSave";

/**
 * 「外部服务」面板的壁纸地址已按设备拆分（电脑 / 手机各一条）。
 *
 * 这里锁住两件事：新增的两个手机端输入框确实渲染出来（否则用户根本改不了），
 * 以及面板读取的是服务端返回值而不是写死的默认值。
 */

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

const PROFILE = {
  id: 1,
  wallpaperLandscapeApi: "https://cdn.example.com/fj-desktop",
  wallpaperLandscapeApiMobile: "https://cdn.example.com/fj-mobile",
  wallpaperAnimeApi: "https://cdn.example.com/anime-desktop",
  wallpaperAnimeApiMobile: "https://cdn.example.com/anime-mobile",
};

describe("外部服务面板：壁纸地址按设备拆分", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).startsWith("/api/profile")) return jsonResponse(PROFILE);
        return jsonResponse({ error: "not found" }, false, 404);
      })
    );
  });

  it("四个壁纸地址输入框全部渲染，且带出服务端已配置的值", async () => {
    render(
      <GlobalSaveProvider>
        <ExternalApiPanel />
      </GlobalSaveProvider>
    );

    const desktopLandscape = (await screen.findByLabelText("随机风景壁纸（电脑）")) as HTMLInputElement;
    const mobileLandscape = screen.getByLabelText("随机风景壁纸（手机）") as HTMLInputElement;
    const desktopAnime = screen.getByLabelText("随机动漫壁纸（电脑）") as HTMLInputElement;
    const mobileAnime = screen.getByLabelText("随机动漫壁纸（手机）") as HTMLInputElement;

    expect(desktopLandscape.value).toBe("https://cdn.example.com/fj-desktop");
    expect(mobileLandscape.value).toBe("https://cdn.example.com/fj-mobile");
    expect(desktopAnime.value).toBe("https://cdn.example.com/anime-desktop");
    expect(mobileAnime.value).toBe("https://cdn.example.com/anime-mobile");
  });
});
