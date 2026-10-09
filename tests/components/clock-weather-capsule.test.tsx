// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ClockWeatherCapsule from "@/components/home/ClockWeatherCapsule";
import { resetWeatherShare } from "@/lib/weatherClient";

/**
 * 时钟天气卡片里风向风力的「可见性」。
 *
 * 回归背景：风向风力原本写成 `hidden ... sm:flex` —— 小于 640px 时整块隐藏，
 * 于是手机上永远看不到风（数据一直都有，是 CSS 把它藏了）。
 * 现在改成「允许换行」：窄屏放不下时风向独占第二行，而不是被裁掉或整块隐藏。
 *
 * 注意：jsdom 不做布局，这里只能断言「写法意图」（不再有断点隐藏、容器允许换行），
 * 真实的折行效果要靠人眼或浏览器验收。
 */

/** 桩 /api/weather：返回一条带风向风力的实况 */
function stubWeather(payload: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
    )
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // 天气取数走模块级共享缓存（供问候弹窗复用同一次请求）：不重置会串场，
  // 后一个用例会直接拿到前一个用例的结果，桩函数根本不被调用
  resetWeatherShare();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ClockWeatherCapsule · 风向风力", () => {
  it("渲染风向与风力，且不再依赖断点隐藏（手机端也要能看到）", async () => {
    stubWeather({
      city: "杭州市",
      weather: "多云",
      temperature: "26℃",
      winddirection: "西北风",
      windpower: "3-4级",
    });

    render(<ClockWeatherCapsule />);

    const wind = await screen.findByText(/西北风/);
    expect(wind.textContent).toContain("3-4级");
    // 关键回归：不能再用 hidden + sm:flex 这种「窄屏整块隐藏」的写法
    expect(wind.className).not.toMatch(/\bhidden\b/);
  });

  it("风向风力所在行允许换行，窄屏放不下时折到第二行而不是被裁掉", async () => {
    stubWeather({ weather: "雷阵雨", temperature: "28℃", winddirection: "西北风", windpower: "3-4级" });

    const { container } = render(<ClockWeatherCapsule />);
    const wind = await screen.findByText(/西北风/);
    const row = wind.parentElement as HTMLElement;

    expect(row.className).toContain("flex-wrap");
    expect(row.className).toContain("gap-x-3");
    // 折行后分隔点不该孤零零留在上一行末尾：第二个 · 在窄屏必须收起
    const dots = Array.from(container.querySelectorAll("span")).filter(
      (el) => el.textContent === "·"
    );
    expect(dots).toHaveLength(2);
    expect(dots.some((el) => el.className.includes("max-sm:hidden"))).toBe(true);
  });

  it("上游只给「西北 / 3-4」这类裸值时，补上「风」「级」再展示", async () => {
    stubWeather({ weather: "晴", temperature: "20℃", winddirection: "西北", windpower: "3-4" });

    render(<ClockWeatherCapsule />);

    const wind = await screen.findByText(/西北风/);
    expect(wind.textContent?.replace(/\s+/g, " ")).toContain("西北风 3-4级");
  });
});
