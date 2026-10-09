// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import MusicProvider, { AUTO_COLLAPSE_MS, NOTICE_REVEAL_SETTLE_MS } from "@/components/home/MusicPlayer";

/**
 * 音乐列表面板里的「设置视图」。
 *
 * 背景：设置项从 3 组长到 15 项后，一列铺开接近 20 行 —— 面板必须整体滚动，
 * 把播放器和歌单一起挤下去（用户反馈的「打开设置就拥挤」）。改成「独立视图 + 三组」后，
 * 这里锁住四件事：
 * 1. 设置与播放器互斥（设置打开时播放器主体不再渲染，不再被挤下去）；
 * 2. 三个分组各装哪些设置（挪错组、漏项都会失败）；
 * 3. 切组不影响「恢复默认」的可见性；
 * 4. 返回能回到播放器，且头部标题跟着切换。
 */

/** 打开弹窗：走既有的 window 事件约定（Provider 监听 toggle-music-player） */
function setup() {
  render(
    <MusicProvider songApi="" songId="" autoplay={false}>
      <div />
    </MusicProvider>
  );
  // 音乐侧栏在首次访问时会展开示范一次，随后自动收起。本文件测的是音乐列表弹窗，
  // 先把这个示范跑完，免得侧栏的「尚未配置歌单」提示与弹窗里的那份重名。
  act(() => {
    vi.advanceTimersByTime(NOTICE_REVEAL_SETTLE_MS + AUTO_COLLAPSE_MS + 50);
  });
  act(() => {
    window.dispatchEvent(new Event("toggle-music-player"));
  });
}

function openSettings() {
  fireEvent.click(screen.getByLabelText("面板设置"));
}

function switchTab(label: string) {
  fireEvent.click(screen.getByRole("tab", { name: label }));
}

/** 三个分组分别应包含的设置项（覆盖全部 16 项，等于把信息架构钉在这里） */
const GROUP_ITEMS: Record<string, string[]> = {
  外观: ["面板风格", "面板不透明度", "面板内显示曲目", "歌单显示封面"],
  歌词: ["悬浮歌词字号", "歌词对齐", "顶部常驻歌词", "面板内显示歌词", "歌词聚焦（非当前行模糊）"],
  播放: [
    "自动播放",
    "初始音量",
    "记住播放模式",
    "续播上次曲目",
    "关闭弹窗后继续播放",
    "键盘快捷键（空格 / PgUp / PgDn）",
    "系统媒体控制（锁屏 / 耳机）",
  ],
};

beforeEach(() => {
  localStorage.clear();
  // 侧栏的「展开示范」标记记在 sessionStorage：不清会让用例之间互相影响
  sessionStorage.clear();
  // 只替换与本文件相关的定时器（侧栏的示范与收起的判定），Date / rAF 等保持真实，
  // 避免影响 React 的调度
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("设置视图：与播放器互斥", () => {
  it("打开设置后只渲染设置，播放器主体让位（不再被挤下去）", () => {
    setup();
    // 播放器视图：有曲目信息与空歌单提示
    expect(screen.getByText("选择一首歌曲")).toBeTruthy();
    expect(screen.getByText(/尚未配置音乐歌单/)).toBeTruthy();

    openSettings();

    expect(screen.getByRole("tablist")).toBeTruthy();
    expect(screen.queryByText("选择一首歌曲")).toBeNull();
    expect(screen.queryByText(/尚未配置音乐歌单/)).toBeNull();
    // 传输控制也不该留在设置视图里
    expect(screen.queryByLabelText("上一首")).toBeNull();
  });

  it("头部标题随视图切换：进入显示「设置」，返回显示面板标签", () => {
    setup();
    expect(screen.getByText("SIDE A")).toBeTruthy();

    openSettings();
    expect(screen.getByText("设置")).toBeTruthy();
    expect(screen.queryByText("SIDE A")).toBeNull();

    fireEvent.click(screen.getByLabelText("返回播放器"));
    expect(screen.getByText("SIDE A")).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("返回后播放器内容恢复", () => {
    setup();
    openSettings();
    fireEvent.click(screen.getByLabelText("返回播放器"));

    expect(screen.getByText("选择一首歌曲")).toBeTruthy();
  });
});

describe("设置视图：分组归位", () => {
  it("默认停在「外观」组", () => {
    setup();
    openSettings();

    expect(screen.getByRole("tab", { name: "外观" }).getAttribute("aria-selected")).toBe("true");
    for (const label of GROUP_ITEMS["外观"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    // 其它组的内容不该同时出现
    expect(screen.queryByText("悬浮歌词字号")).toBeNull();
    expect(screen.queryByText("初始音量")).toBeNull();
  });

  it("三个标签名固定为 外观 / 歌词 / 播放", () => {
    setup();
    openSettings();

    expect(screen.getAllByRole("tab").map((el) => el.textContent)).toEqual([
      "外观",
      "歌词",
      "播放",
    ]);
  });

  it("每组只展示自己那几项，且全部 16 项都能被找到", () => {
    setup();
    openSettings();

    const seen = new Set<string>();
    for (const [tab, items] of Object.entries(GROUP_ITEMS)) {
      switchTab(tab);
      for (const label of items) {
        expect(screen.getByText(label)).toBeTruthy();
        seen.add(label);
      }
      // 同组之外的项目不应出现（用相邻组的首项做交叉验证）
      for (const [otherTab, otherItems] of Object.entries(GROUP_ITEMS)) {
        if (otherTab === tab) continue;
        for (const label of otherItems) {
          expect(screen.queryByText(label)).toBeNull();
        }
      }
    }
    expect(seen.size).toBe(16);
  });

  it("「恢复默认设置」在任何分组下都可见", () => {
    setup();
    openSettings();

    for (const tab of Object.keys(GROUP_ITEMS)) {
      switchTab(tab);
      expect(screen.getByText("恢复默认设置")).toBeTruthy();
    }
  });
});

describe("设置视图：改动即时生效（本机偏好）", () => {
  it("切换开关既更新界面状态，也落盘到 localStorage", () => {
    setup();
    openSettings();
    switchTab("播放");

    const row = screen.getByLabelText("记住播放模式");
    expect(row.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(row);

    expect(screen.getByLabelText("记住播放模式").getAttribute("aria-checked")).toBe("false");
    expect(localStorage.getItem("music-player-remember-mode")).toBe("0");
  });

  it("「自动播放」默认关闭，打开后落盘（避免页面一打开就出声）", () => {
    setup();
    openSettings();
    switchTab("播放");

    const row = screen.getByLabelText("自动播放");
    expect(row.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(row);

    expect(screen.getByLabelText("自动播放").getAttribute("aria-checked")).toBe("true");
    expect(localStorage.getItem("music-player-autoplay")).toBe("1");
  });

  it("切组不会重置已改过的偏好", () => {
    setup();
    openSettings();

    switchTab("歌词");
    fireEvent.click(screen.getByLabelText("顶部常驻歌词"));
    expect(localStorage.getItem("music-player-top-lyrics")).toBe("0");

    switchTab("外观");
    switchTab("歌词");
    expect(screen.getByLabelText("顶部常驻歌词").getAttribute("aria-checked")).toBe("false");
  });
});
