// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import MusicProvider, {
  AUTO_COLLAPSE_MS,
  NOTICE_POLL_MS,
  NOTICE_REVEAL_SETTLE_MS,
} from "@/components/home/MusicPlayer";
import { HANDLE_SIDE_KEY, HANDLE_BOTTOM_KEY } from "@/lib/musicPanelThemes";

/**
 * 音乐侧栏：可拖动的竖直把手 + 展开抽屉。
 *
 * 收起 / 展开的手感与位置都在 CSS（见 tests/lib/music-sidebar-style.test.ts），
 * 这里锁行为：
 * 1. 只在本会话**首次**访问时做一次展开示范，且倒计时从「欢迎通知离场」之后才开始；
 * 2. 单击把手打开抽屉（单击与拖动必须能区分开）；
 * 3. 停靠位置默认左侧，拖动后吸附到最近的一侧并落盘，下次访问沿用；
 * 4. 把手不承担信息位；
 * 5. 「音乐列表」仍然只进既有的那个弹窗。
 */

function setup(props: { musicSidebarDefault?: string } = {}) {
  return render(
    <MusicProvider songApi="" songId="" autoplay={false} {...props}>
      <div />
    </MusicProvider>
  );
}

/** 跑过「等一拍判定 → 3 秒倒计时」，回到「只有把手」的稳定态 */
function settleAutoCollapse() {
  act(() => {
    vi.advanceTimersByTime(NOTICE_REVEAL_SETTLE_MS + AUTO_COLLAPSE_MS + 50);
  });
}

const drawerOpen = () => screen.queryByText("正在播放") !== null;
const handle = () => screen.queryByLabelText("展开音乐控制");

/** 造一块欢迎通知的遮罩（与 AnnouncementNotification 的根节点同名） */
function mountNoticeScrim(): HTMLElement {
  const scrim = document.createElement("div");
  scrim.className = "notice-scrim";
  document.body.appendChild(scrim);
  return scrim;
}

/** jsdom 没有布局：给把手一个合理的矩形（默认左侧贴边贴底），拖动数学才成立 */
function mockHandleRect() {
  return vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 700,
    width: 44,
    height: 98,
    right: 44,
    bottom: 798,
    x: 0,
    y: 700,
    toJSON: () => ({}),
  } as DOMRect);
}

beforeEach(() => {
  localStorage.clear();
  // 「展开示范」的标记记在 sessionStorage：不清会让后面每个用例都跳过开头那段
  sessionStorage.clear();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  // 歌单接口返回空数组：抽屉走「尚未配置歌单」分支，不依赖任何网络数据
  vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.querySelectorAll(".notice-scrim").forEach((el) => el.remove());
});

describe("音乐侧栏：只首次访问展开一次，且等通知离场后才计时", () => {
  it("挂载即展开，过了自动收起窗口后只留把手", () => {
    setup();
    expect(drawerOpen(), "首次访问应当展开一次，让人看见这个入口").toBe(true);
    expect(handle()).toBeNull();

    settleAutoCollapse();
    expect(drawerOpen()).toBe(false);
    expect(handle()).toBeTruthy();
  });

  it("同一个标签页里再来一次就不再展开（只示范一次）", () => {
    sessionStorage.setItem("music-sidebar-intro-shown", "1");
    setup();

    expect(drawerOpen(), "本会话已经示范过，不该再自动展开").toBe(false);
    expect(handle()).toBeTruthy();
  });

  it("欢迎通知还挡着时不开始倒计时，通知关掉后才开始算", () => {
    const scrim = mountNoticeScrim();
    setup();
    expect(drawerOpen()).toBe(true);

    // 通知还在：过了 3 秒也不该收（否则抽屉会在弹窗还开着的时候自己收走）
    act(() => {
      vi.advanceTimersByTime(AUTO_COLLAPSE_MS + 1000);
    });
    expect(drawerOpen(), "通知还挡着，不该开始倒计时").toBe(true);

    // 关掉通知 → 轮询发现它走了 → 才开始 3 秒倒计时
    scrim.remove();
    act(() => {
      vi.advanceTimersByTime(NOTICE_POLL_MS + 50);
    });
    expect(drawerOpen(), "刚关掉通知，倒计时才刚开始").toBe(true);

    settleAutoCollapse();
    expect(drawerOpen()).toBe(false);
    expect(handle()).toBeTruthy();
  });

  it("默认贴左侧，且位置由 CSS 变量给出（水平贴边 0、底 16px）", () => {
    setup();
    settleAutoCollapse();

    const btn = handle()!;
    expect(btn.getAttribute("data-side")).toBe("left");
    // jsdom 视口 1024×768、把手 44×98：水平贴边 → x = 0；底 16 → y = 768 - 16 - 98 = 654
    expect(btn.style.getPropertyValue("--handle-x"), "水平是贴边的，不该留缝").toBe("0px");
    expect(btn.style.getPropertyValue("--handle-y")).toBe("654px");
  });

  it("默认收起（后台可配）：进门只有把手，过多久都不会自己弹开", () => {
    setup({ musicSidebarDefault: "collapse" });

    expect(drawerOpen(), "配置成默认收起时不该展开").toBe(false);
    expect(handle()).toBeTruthy();

    settleAutoCollapse();
    expect(drawerOpen()).toBe(false);
  });

  it("默认展开（后台可配）：常驻打开、不铺遮罩、也不会自己收走", () => {
    const { container } = setup({ musicSidebarDefault: "expand" });

    expect(drawerOpen()).toBe(true);
    expect(container.querySelector(".music-drawer-scrim"), "常驻面板不该铺满屏遮罩").toBeNull();

    settleAutoCollapse();
    expect(drawerOpen(), "配置成默认展开就该保持打开").toBe(true);
  });

  it("默认展开时访客自己收起后不会被弹回来", () => {
    setup({ musicSidebarDefault: "expand" });
    act(() => {
      fireEvent.click(screen.getByLabelText("收起音乐控制"));
    });
    expect(drawerOpen()).toBe(false);

    settleAutoCollapse();
    expect(drawerOpen(), "收起是访客的意愿，不该被默认值覆盖").toBe(false);
    expect(handle()).toBeTruthy();
  });

  it("访客自己点开的抽屉仍是模态：铺遮罩、点空白处能关", () => {
    const { container } = setup({ musicSidebarDefault: "collapse" });
    act(() => {
      fireEvent.click(handle()!);
    });

    const scrim = container.querySelector(".music-drawer-scrim");
    expect(scrim, "访客点开的抽屉应铺遮罩").toBeTruthy();
    act(() => {
      fireEvent.click(scrim!);
    });
    expect(drawerOpen()).toBe(false);
  });

  it("窗口内用户自己开过，就不再自动收走", () => {
    setup();
    // 先自己收起，再点把手打开 —— 这一串动作会把「用户已交互」标上
    act(() => {
      fireEvent.click(screen.getByLabelText("收起音乐控制"));
    });
    act(() => {
      fireEvent.click(handle()!);
    });
    expect(drawerOpen()).toBe(true);

    settleAutoCollapse();
    expect(drawerOpen(), "用户已经动过手，不该再自动收走").toBe(true);
  });
});

describe("音乐侧栏：收起 / 展开", () => {
  it("把手带方向箭头，且不承担信息位（不留常驻曲名）", () => {
    setup();
    settleAutoCollapse();

    const btn = handle()!;
    expect(btn.className).toContain("music-handle");
    expect(btn.querySelector("svg")).toBeTruthy();
    // 不渲染任何常驻文字：曲名只留在 title 悬浮提示里
    expect(btn.textContent?.trim()).toBe("");
    expect(btn.getAttribute("title")).toBe("音乐控制（可拖动）");
  });

  it("点把手打开抽屉（含标题与歌单未配置提示）", () => {
    setup();
    settleAutoCollapse();
    act(() => {
      fireEvent.click(handle()!);
    });

    expect(screen.getByText("正在播放")).toBeTruthy();
    expect(screen.getByText(/尚未配置音乐歌单/)).toBeTruthy();
    // 展开后把手让位，避免与抽屉重叠
    expect(handle()).toBeNull();
  });

  it("点右上角 × 收起抽屉，回到把手", () => {
    setup();
    settleAutoCollapse();
    act(() => {
      fireEvent.click(handle()!);
    });
    act(() => {
      fireEvent.click(screen.getByLabelText("收起音乐控制"));
    });

    expect(drawerOpen()).toBe(false);
    expect(handle()).toBeTruthy();
  });

  it("点遮罩（空白处）也能收起", () => {
    const { container } = setup();
    settleAutoCollapse();
    act(() => {
      fireEvent.click(handle()!);
    });

    const scrim = container.querySelector(".music-drawer-scrim");
    expect(scrim).toBeTruthy();
    act(() => {
      fireEvent.click(scrim!);
    });

    expect(drawerOpen()).toBe(false);
    expect(handle()).toBeTruthy();
  });

  it("「音乐列表」进既有弹窗：歌单 / 歌词 / 设置仍然只在一处实现", () => {
    setup();
    settleAutoCollapse();
    act(() => {
      fireEvent.click(handle()!);
    });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "音乐列表" }));
    });

    // 抽屉里的按钮文案是「音乐列表」，弹窗自身的 aria-label 也是「音乐列表」，用 role 区分
    expect(screen.getByRole("dialog", { name: "音乐列表" })).toBeTruthy();
  });

  it("抽屉里只有一处进音乐列表的入口（不做重复入口）", () => {
    setup();
    settleAutoCollapse();
    act(() => {
      fireEvent.click(handle()!);
    });

    expect(screen.getAllByRole("button", { name: "音乐列表" })).toHaveLength(1);
    expect(screen.queryByLabelText("打开音乐列表")).toBeNull();
  });

  it("歌单为空时入口依然在（否则抽屉里只看到一句提示，进不去弹窗看详情 / 进设置）", () => {
    setup();
    settleAutoCollapse();
    act(() => {
      fireEvent.click(handle()!);
    });

    expect(screen.getByText(/尚未配置音乐歌单/)).toBeTruthy();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "音乐列表" }));
    });
    expect(screen.getByRole("dialog", { name: "音乐列表" })).toBeTruthy();
  });
});

describe("音乐侧栏：按住拖动、松手贴合两侧", () => {
  it("拖动中标记 dragging，松手吸附到最近的一侧并记住位置", () => {
    setup();
    settleAutoCollapse();
    mockHandleRect();

    const btn = handle()!;
    // 从把手中心(22,749)拖到屏幕右侧偏上(600,300)
    act(() => {
      fireEvent.pointerDown(btn, { pointerId: 1, clientX: 22, clientY: 749 });
      fireEvent.pointerMove(btn, { pointerId: 1, clientX: 600, clientY: 300 });
    });
    expect(handle()!.getAttribute("data-dragging"), "拖动中要有状态标记（跟手 + 抬起感）").toBe("true");

    act(() => {
      fireEvent.pointerUp(btn, { pointerId: 1, clientX: 600, clientY: 300 });
    });
    expect(handle()!.getAttribute("data-dragging")).toBe("false");

    // 水平吸附到最近的一侧（松手点在中线右侧 → 右），垂直位置保持
    expect(localStorage.getItem(HANDLE_SIDE_KEY)).toBe("right");
    expect(localStorage.getItem(HANDLE_BOTTOM_KEY)).toBe("419");
    // 右侧贴合：x = 1024 - 44 - 0 = 980；y = 768 - 419 - 98 = 251
    const after = handle()!;
    expect(after.getAttribute("data-side")).toBe("right");
    expect(after.style.getPropertyValue("--handle-x")).toBe("980px");
    expect(after.style.getPropertyValue("--handle-y")).toBe("251px");
  });

  it("下次访问沿用记住的停靠位置", () => {
    localStorage.setItem(HANDLE_SIDE_KEY, "right");
    localStorage.setItem(HANDLE_BOTTOM_KEY, "300");
    setup();
    settleAutoCollapse();

    const btn = handle()!;
    expect(btn.getAttribute("data-side")).toBe("right");
    expect(btn.style.getPropertyValue("--handle-x")).toBe("980px");
    expect(btn.style.getPropertyValue("--handle-y")).toBe("370px");
  });

  it("单击（没有位移）仍然打开抽屉，且不写位置", () => {
    setup();
    settleAutoCollapse();
    mockHandleRect();

    const btn = handle()!;
    act(() => {
      fireEvent.pointerDown(btn, { pointerId: 1, clientX: 22, clientY: 749 });
      fireEvent.pointerMove(btn, { pointerId: 1, clientX: 24, clientY: 750 });
      fireEvent.pointerUp(btn, { pointerId: 1, clientX: 24, clientY: 750 });
      fireEvent.click(btn);
    });

    expect(drawerOpen(), "位移不到阈值就该当成点击").toBe(true);
    expect(localStorage.getItem(HANDLE_SIDE_KEY)).toBeNull();
  });
});

describe("音乐入口不再挂在一言卡片上", () => {
  it("页面里没有「打开音乐播放器」按钮（该按钮属于旧的就地互换方案）", () => {
    const { container } = setup();
    expect(container.querySelector('[aria-label="打开音乐播放器"]')).toBeNull();
  });
});
