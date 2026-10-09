// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import MusicProvider from "@/components/home/MusicPlayer";

/**
 * 音乐侧栏：右下角常驻圆钮 + 展开抽屉。
 *
 * 音乐入口从「与一言互换的功能卡格」搬到右下角浮层，这里锁住四件事：
 * 1. 收起态只有一颗圆钮，不渲染抽屉（不占布局、不遮挡内容的前提）；
 * 2. 圆钮点开后抽屉出现，遮罩点击可收起；
 * 3. 抽屉里能进音乐列表弹窗（重内容仍留在既有弹窗，侧栏不重复实现）；
 * 4. 一言卡片不再承担音乐入口（回归：防止又把它塞回卡里）。
 */

function setup() {
  return render(
    <MusicProvider songApi="" songId="" autoplay={false}>
      <div />
    </MusicProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  // 歌单接口返回空数组：抽屉走「尚未配置歌单」分支，不依赖任何网络数据
  vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("音乐侧栏：收起 / 展开", () => {
  it("收起态只渲染一颗圆钮，不渲染抽屉", () => {
    setup();
    expect(screen.getByLabelText("展开音乐控制")).toBeTruthy();
    expect(screen.queryByText("正在播放")).toBeNull();
  });

  it("收起态是竖直把手：带方向箭头与竖排曲名，不是容易被忽略的小圆点", () => {
    setup();
    const handle = screen.getByLabelText("展开音乐控制");
    expect(handle.className).toContain("music-handle");
    // 未配置歌单时显示兜底文案「音乐」—— 把手不靠图标单独支撑可辨识度
    expect(handle.textContent).toContain("音乐");
    expect(handle.querySelector("svg")).toBeTruthy();
  });

  it("点把手后抽屉出现（含标题与歌单未配置提示）", async () => {
    setup();
    await act(async () => {
      fireEvent.click(screen.getByLabelText("展开音乐控制"));
    });

    expect(screen.getByText("正在播放")).toBeTruthy();
    expect(screen.getByText(/尚未配置音乐歌单/)).toBeTruthy();
    // 展开后圆钮让位，避免与抽屉重叠
    expect(screen.queryByLabelText("展开音乐控制")).toBeNull();
  });

  it("点右上角 × 收起抽屉，回到把手", async () => {
    setup();
    await act(async () => {
      fireEvent.click(screen.getByLabelText("展开音乐控制"));
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("收起音乐控制"));
    });

    expect(screen.queryByText("正在播放")).toBeNull();
    expect(screen.getByLabelText("展开音乐控制")).toBeTruthy();
  });

  it("点遮罩（空白处）也能收起", async () => {
    const { container } = setup();
    await act(async () => {
      fireEvent.click(screen.getByLabelText("展开音乐控制"));
    });

    const scrim = container.querySelector(".music-drawer-scrim");
    expect(scrim).toBeTruthy();
    await act(async () => {
      fireEvent.click(scrim!);
    });

    expect(screen.queryByText("正在播放")).toBeNull();
    expect(screen.getByLabelText("展开音乐控制")).toBeTruthy();
  });

  it("「音乐列表」进既有弹窗：歌单 / 歌词 / 设置仍然只在一处实现", async () => {
    setup();
    await act(async () => {
      fireEvent.click(screen.getByLabelText("展开音乐控制"));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "音乐列表" }));
    });

    // 抽屉里的按钮文案是「音乐列表」，弹窗自身的 aria-label 也是「音乐列表」，用 role 区分
    expect(screen.getByRole("dialog", { name: "音乐列表" })).toBeTruthy();
  });

  it("抽屉里只有一处进音乐列表的入口（不做重复入口）", async () => {
    setup();
    await act(async () => {
      fireEvent.click(screen.getByLabelText("展开音乐控制"));
    });

    expect(screen.getAllByRole("button", { name: "音乐列表" })).toHaveLength(1);
    expect(screen.queryByLabelText("打开音乐列表")).toBeNull();
  });

  it("歌单为空时入口依然在（否则抽屉里只看到一句提示，进不去弹窗看详情 / 进设置）", async () => {
    setup();
    await act(async () => {
      fireEvent.click(screen.getByLabelText("展开音乐控制"));
    });

    expect(screen.getByText(/尚未配置音乐歌单/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "音乐列表" }));
    });
    expect(screen.getByRole("dialog", { name: "音乐列表" })).toBeTruthy();
  });
});

describe("音乐入口不再挂在一言卡片上", () => {
  it("页面里没有「打开音乐播放器」按钮（该按钮属于旧的就地互换方案）", () => {
    const { container } = setup();
    expect(container.querySelector('[aria-label="打开音乐播放器"]')).toBeNull();
  });
});
