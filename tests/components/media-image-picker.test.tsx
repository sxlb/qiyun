// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import MediaImagePicker from "@/components/admin/MediaImagePicker";

/**
 * 通用图片选择器：媒体库与壁纸缓存两个来源页签。
 *
 * 两者是**两套数据源**（ImageAsset 分页 vs manifest 不分页），因此这里锁住：
 * 1. 打开时分别请求 /api/media 与 /api/wallpaper/cache；
 * 2. 壁纸缓存侧按「预算组 → 来源」两级分组展示，而不是平铺；
 * 3. 点击任一来源的图片都会把地址回传给 onSelect 并关闭弹层。
 */

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

const MEDIA = {
  items: [
    { id: 1, url: "/api/uploads/file/a.png", fileName: "a.png", width: 100, height: 100 },
  ],
  total: 1,
  page: 1,
  pageSize: 24,
};

const CACHE = {
  items: [
    { fileName: "pc-anime.webp", url: "/api/wallpaper/file/pc-anime.webp", size: 2048, tag: "anime:pc", exists: true },
    { fileName: "pc-land.webp", url: "/api/wallpaper/file/pc-land.webp", size: 2048, tag: "landscape:pc", exists: true },
    { fileName: "mobile-anime.webp", url: "/api/wallpaper/file/mobile-anime.webp", size: 1024, tag: "anime:mobile", exists: true },
    { fileName: "bing.webp", url: "/api/wallpaper/file/bing.webp", size: 512, tag: "shared", exists: true },
  ],
  total: 4,
};

const requests: string[] = [];

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  requests.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (url.startsWith("/api/wallpaper/cache")) return jsonResponse(CACHE);
      if (url.startsWith("/api/media")) return jsonResponse(MEDIA);
      return jsonResponse({ error: "not found" }, false, 404);
    })
  );
});

/** 打开弹层（触发按钮默认文案「选择图片」） */
async function openPicker(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /选择图片/ }));
  await screen.findByRole("dialog", { name: "选择图片" });
}

describe("MediaImagePicker 图片选择器", () => {
  it("打开时同时请求媒体库与壁纸缓存两份数据源", async () => {
    const user = userEvent.setup();
    render(<MediaImagePicker onSelect={() => {}} />);
    await openPicker(user);

    await waitFor(() => {
      expect(requests.some((r) => r.startsWith("/api/media"))).toBe(true);
      expect(requests.some((r) => r.startsWith("/api/wallpaper/cache"))).toBe(true);
    });
  });

  it("默认停在媒体库页签，并展示媒体库张数", async () => {
    const user = userEvent.setup();
    render(<MediaImagePicker onSelect={() => {}} />);
    await openPicker(user);

    expect(await screen.findByText(/媒体库 1 张/)).toBeTruthy();
    expect(await screen.findByAltText("a.png")).toBeTruthy();
  });

  it("切到壁纸缓存页签：按预算组 → 来源两级分组展示", async () => {
    const user = userEvent.setup();
    render(<MediaImagePicker onSelect={() => {}} />);
    await openPicker(user);

    await user.click(screen.getByRole("button", { name: /壁纸缓存/ }));

    // 一级：预算组分段（电脑 / 手机 / 必应共享）
    expect(await screen.findByText("电脑")).toBeTruthy();
    expect(screen.getByText("手机")).toBeTruthy();
    expect(screen.getByText("必应共享")).toBeTruthy();
    // 二级：电脑组内含两种来源，标题写明「风景 · 1 张」「动漫 · 1 张」
    expect(screen.getByText(/风景 · 1 张/)).toBeTruthy();
    expect(screen.getByText(/动漫 · 1 张/)).toBeTruthy();
    // 卡片以可读文案标注来源与设备，而非 anime:pc 这种原始标签
    expect(screen.getByAltText("pc-anime.webp")).toBeTruthy();
    expect(screen.getByTitle("pc-anime.webp（动漫 · 电脑）")).toBeTruthy();
  });

  it("点击壁纸缓存里的图片：回传地址并关闭弹层", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<MediaImagePicker onSelect={onSelect} />);
    await openPicker(user);

    await user.click(screen.getByRole("button", { name: /壁纸缓存/ }));
    await user.click(await screen.findByAltText("bing.webp"));

    expect(onSelect).toHaveBeenCalledWith("/api/wallpaper/file/bing.webp");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("点击媒体库图片：回传地址并关闭弹层", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<MediaImagePicker onSelect={onSelect} />);
    await openPicker(user);

    await user.click(await screen.findByAltText("a.png"));

    expect(onSelect).toHaveBeenCalledWith("/api/uploads/file/a.png");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("Esc 关闭弹层", async () => {
    const user = userEvent.setup();
    render(<MediaImagePicker onSelect={() => {}} />);
    await openPicker(user);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});