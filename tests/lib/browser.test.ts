import { describe, expect, it } from "vitest";
import { detectBrowser } from "@/lib/browser";

/**
 * 浏览器识别的核心是「顺序」：现代浏览器 UA 是套娃结构，Edge 的 UA 里同时含
 * `Chrome/` 与 `Safari/`。这组用例把顺序钉住 —— 一旦有人把 `Chrome/` 或 `Safari/`
 * 的分支提到前面，前两条立刻失败。
 */
describe("detectBrowser · 套娃 UA 与判定顺序", () => {
  const EDGE_WIN =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0";
  const CHROME_WIN =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  const SAFARI_MAC =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15";

  it("Edge 的 UA 同时含 Chrome/ 与 Safari/，仍要判成 Edge", () => {
    expect(EDGE_WIN).toContain("Chrome/");
    expect(EDGE_WIN).toContain("Safari/");
    expect(detectBrowser(EDGE_WIN)).toBe("Edge");
  });

  it("Chrome 的 UA 含 Safari/，不能被 Safari 截胡", () => {
    expect(CHROME_WIN).toContain("Safari/");
    expect(detectBrowser(CHROME_WIN)).toBe("Chrome");
  });

  it("Safari 只在没有任何 Chromium 标识时才命中", () => {
    expect(detectBrowser(SAFARI_MAC)).toBe("Safari");
  });

  it("Firefox 走 Gecko，与上面三家互不干扰", () => {
    expect(
      detectBrowser(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0"
      )
    ).toBe("Firefox");
  });

  it("Opera 的 UA 也含 Chrome/，必须先于 Chrome 判断", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 OPR/105.0.0.0";
    expect(ua).toContain("Chrome/");
    expect(detectBrowser(ua)).toBe("Opera");
  });
});

/** 移动端标识与桌面不同，漏掉变体会掉到后面的分支（例如 iOS 版 Edge 变成 Safari） */
describe("detectBrowser · 移动端标识变体", () => {
  const IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)";

  it.each([
    ["Android 版 Edge", "EdgA/120.0.0.0", "Edge"],
    ["iOS 版 Edge", "EdgiOS/120.0.0.0", "Edge"],
    ["iOS 版 Chrome", "CriOS/120.0.0.0", "Chrome"],
    ["iOS 版 Firefox", "FxiOS/121.0", "Firefox"],
    ["iOS 版 Opera", "OPiOS/2.2.0.11246", "Opera"],
  ])("%s", (_label, token, expected) => {
    expect(detectBrowser(`${IPHONE} ${token} Mobile/15E148 Safari/604.1`)).toBe(expected);
  });

  it("Android 版 Chrome 仍归 Chrome，不会掉到 Safari", () => {
    expect(
      detectBrowser(
        "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
      )
    ).toBe("Chrome");
  });
});

/** 套壳浏览器同样基于 Chromium，UA 里也带 Chrome/Safari 标识，必须排在最前 */
describe("detectBrowser · 套壳与国产浏览器", () => {
  it("微信内置浏览器：UA 里带 Chrome/ 也仍判微信", () => {
    const ua =
      "Mozilla/5.0 (Linux; Android 13; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.40.2420(0x28002837) WeChat/arm64";
    expect(ua).toContain("Chrome/");
    expect(detectBrowser(ua)).toBe("微信浏览器");
  });

  it.each([
    ["QQ 浏览器", "QQBrowser/14.7.0.0"],
    ["UC 浏览器", "UCBrowser/15.5.8.1225"],
    ["夸克", "Quark/6.9.0.260"],
    ["百度浏览器", "BIDUBrowser/7.6"],
    ["华为浏览器", "HuaweiBrowser/12.1.4.302"],
    ["小米浏览器", "MiuiBrowser/17.2.3"],
    ["360 浏览器", "QIHU 360SE"],
    ["搜狗浏览器", "MetaSr 1.0"],
    ["Samsung 浏览器", "SamsungBrowser/23.0"],
  ])("%s", (_label, token) => {
    const ua = `Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36 ${token}`;
    expect(detectBrowser(ua)).not.toBe("Chrome");
    expect(detectBrowser(ua)).not.toBe("Safari");
  });
});

describe("detectBrowser · 边界", () => {
  it("空 UA 返回空字符串", () => {
    expect(detectBrowser("")).toBe("");
  });

  it("无任何浏览器标识时返回空字符串，由调用方展示为「未知」", () => {
    expect(detectBrowser("curl/8.4.0")).toBe("");
  });
});
