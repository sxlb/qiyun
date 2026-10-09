// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import ClockWeatherCapsule from "@/components/home/ClockWeatherCapsule";
import AnnouncementNotification from "@/components/home/AnnouncementNotification";
import { resetWeatherShare } from "@/lib/weatherClient";

/**
 * 首页同屏两处（时钟天气卡片 + 欢迎弹窗）共用的**同一次**天气请求。
 *
 * 这是这次改动的核心诉求：天气接口在未配置固定城市时本来就会按访客 IP 定位，
 * 欢迎弹窗直接复用这次请求顺带返回的 region，而不是再去查一次地域
 * （那样既多一次请求，精度还更低 —— 离线库不如腾讯/高德的 IP 库）。
 */

const WELCOME = JSON.stringify(["欢迎来到本站～"]);

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  resetWeatherShare();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("首页两处共用一次天气请求", () => {
  it("同时挂载时天气只请求一次，且两处各自拿到了需要的东西", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        seen.push(url);
        if (url.includes("/api/announcements/public")) return jsonResponse([]);
        if (url.includes("/api/weather")) {
          return jsonResponse({
            city: "深圳市",
            weather: "晴",
            temperature: "25℃",
            region: "广东省 深圳市",
          });
        }
        return jsonResponse({ region: "不该被请求到" });
      })
    );

    render(
      <>
        <ClockWeatherCapsule />
        <AnnouncementNotification welcomeEnabled siteName="栖云" welcomeMessages={WELCOME} />
      </>
    );
    await act(async () => {});
    await act(async () => {});

    // 核心断言：一次请求，两个消费方
    expect(seen.filter((u) => u.includes("/api/weather"))).toHaveLength(1);

    // 时钟卡片拿到天气
    expect(screen.getByText("深圳市")).toBeTruthy();
    expect(screen.getByText("晴")).toBeTruthy();

    // 欢迎弹窗拿到地域，且没有为此单独请求离线库接口
    expect(screen.getByText(/广东省 深圳市/)).toBeTruthy();
    expect(seen.some((u) => u.includes("/api/visitor/location"))).toBe(false);
  });
});
