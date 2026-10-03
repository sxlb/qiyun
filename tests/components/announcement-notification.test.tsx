// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import AnnouncementNotification from "@/components/home/AnnouncementNotification";

/**
 * 欢迎/公告弹窗的唤出时序回归。
 *
 * 「加载动画已移除」事件与 3 秒兜底定时器是两条并行唤出路径。历史 bug：
 * 先到的那条把弹窗弹出来、用户随即点「我知道了」关掉，后到的那条仍会
 * setVisible(true)，弹窗就在关闭后一两秒莫名二次弹出。
 */

const WELCOME = JSON.stringify(["欢迎来到本站～"]);
const DISMISS_KEY = "qiyun-announcement-dismissed";

/** 造一个仍在展示的全屏加载动画占位节点（LoadingScreen 的 id 约定） */
function mountLoader(): HTMLElement {
  const el = document.createElement("div");
  el.id = "loader-wrapper";
  document.body.appendChild(el);
  return el;
}

/** 按 LoadingScreen 既有约定广播「加载动画已移除」 */
function removeLoader(el: HTMLElement) {
  el.remove();
  act(() => {
    window.dispatchEvent(new Event("loading-screen-removed"));
  });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** 默认桩：公告为空、访客归属地拿得到（都不该影响唤出判定） */
function stubFetch(announcements: unknown[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return url.includes("/api/announcements/public")
        ? jsonResponse(announcements)
        : jsonResponse({ region: "浙江 杭州" });
    })
  );
}

/** 弹窗是否可见（以底部主按钮为准，它只在整个弹窗存在时渲染） */
const dialogOpen = () => screen.queryByText("我知道了") !== null;

function renderNotice() {
  return render(
    <AnnouncementNotification welcomeEnabled siteName="栖云" welcomeMessages={WELCOME} />
  );
}

beforeEach(() => {
  localStorage.clear();
  // 只替换与用例相关的两个定时器：Date / rAF 等保持真实，避免影响 React 的调度
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  stubFetch();
});

afterEach(() => {
  vi.useRealTimers();
  document.getElementById("loader-wrapper")?.remove();
});

describe("唤出路径只生效一次", () => {
  it("用户抢在 3 秒兜底前点「我知道了」后，兜底不会把弹窗重新弹出来", async () => {
    const loader = mountLoader();
    renderNotice();
    await act(async () => {});

    // 加载动画移除 → 弹窗出现
    removeLoader(loader);
    expect(dialogOpen()).toBe(true);
    expect(screen.getByText("欢迎来到本站～")).toBeTruthy();

    // 用户立刻关闭
    fireEvent.click(screen.getByText("我知道了"));
    expect(dialogOpen()).toBe(false);

    // 兜底定时器到点：不得二次弹出（历史 bug 的复现点）
    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    expect(dialogOpen()).toBe(false);
  });

  it("关闭后公告才加载完成，也不会把弹窗重新顶出来", async () => {
    const loader = mountLoader();
    let resolveAnnouncements: (res: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/announcements/public")) {
          return new Promise<Response>((resolve) => {
            resolveAnnouncements = resolve;
          });
        }
        return jsonResponse({ region: "" });
      })
    );

    renderNotice();
    removeLoader(loader);
    fireEvent.click(screen.getByText("我知道了"));
    expect(dialogOpen()).toBe(false);

    // 公告此刻才返回（新内容也不该打扰已经明确关闭过的访客）
    await act(async () => {
      resolveAnnouncements(jsonResponse([{ id: 1, title: "新公告", content: "内容", pinned: false }]));
    });
    await act(async () => {
      vi.advanceTimersByTime(4000);
    });

    expect(dialogOpen()).toBe(false);
    // 关键：这次关闭发生在公告落地之前，不能把「没看过的公告」误标成已读
    expect(JSON.parse(localStorage.getItem(DISMISS_KEY) || "[]")).toEqual([]);
  });

  it("事件与兜底都触发时弹窗只存在一个实例", async () => {
    const loader = mountLoader();
    renderNotice();
    await act(async () => {});

    removeLoader(loader);
    await act(async () => {
      vi.advanceTimersByTime(4000);
    });

    expect(screen.getAllByText("我知道了")).toHaveLength(1);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });
});

describe("唤出路径本身仍然可用（防过度修复）", () => {
  it("加载动画移除事件始终不来时，3 秒兜底仍会把弹窗弹出来", async () => {
    mountLoader();
    renderNotice();
    await act(async () => {});
    expect(dialogOpen()).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(dialogOpen()).toBe(true);
  });

  it("挂载时加载动画已不在（关闭了加载动画）则立即弹出，不等兜底", async () => {
    renderNotice();
    expect(dialogOpen()).toBe(true);
  });

  it("没有欢迎语时由公告触发唤出（此时 hasContent 从 false 变 true）", async () => {
    const loader = mountLoader();
    // 公告标题刻意不叫「站点公告」：那是弹窗自身的标题，重名会让 getByText 命中两处
    stubFetch([{ id: 7, title: "维护通知", content: "内容", pinned: false }]);

    render(
      <AnnouncementNotification welcomeEnabled={false} siteName="栖云" welcomeMessages={WELCOME} />
    );
    await act(async () => {});
    expect(dialogOpen()).toBe(false);

    removeLoader(loader);
    expect(dialogOpen()).toBe(true);
    expect(screen.getByText("维护通知")).toBeTruthy();
  });
});

describe("关闭行为", () => {
  it("「我知道了」把当前公告标记为已读并关闭", async () => {
    const loader = mountLoader();
    stubFetch([{ id: 9, title: "公告甲", content: "内容", pinned: false }]);

    renderNotice();
    await act(async () => {});
    removeLoader(loader);

    fireEvent.click(screen.getByText("我知道了"));
    expect(JSON.parse(localStorage.getItem(DISMISS_KEY) || "[]")).toEqual([9]);
    expect(dialogOpen()).toBe(false);
  });

  it("关闭后本次挂载内不再自动唤出（即便 hasContent 重新变化）", async () => {
    const loader = mountLoader();
    renderNotice();
    await act(async () => {});
    removeLoader(loader);
    fireEvent.click(screen.getByText("我知道了"));

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(dialogOpen()).toBe(false);
  });
});
