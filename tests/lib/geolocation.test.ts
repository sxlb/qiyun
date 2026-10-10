// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 精确定位封装的坐标持久化与手动刷新。
 *
 * 回归背景（用户实际反馈的两条）：
 * 1. 「定位后刷新网页又要重新定位」—— 坐标此前只存在模块变量里，刷新即丢失；
 *    现在落盘到 localStorage（带 TTL），刷新直接复用。
 * 2. 「手动点定位没反应」—— 已有坐标时 `requestPreciseCoords` 会原样返回旧值；
 *    手动刷新必须先作废旧坐标（force 语义）。
 *
 * 注意：模块内缓存（坐标 / 已恢复标记 / 在途请求）不清会跨用例串场，
 * 因此每个用例都用 `vi.resetModules()` 拿一份全新的模块实例。
 */

const COORDS_KEY = "qiyun-precise-coords-v1";
const DENIED_KEY = "qiyun-precise-location-denied-v2";

/** 每次用例都重新加载模块，模拟"新的一次页面加载" */
async function loadModule() {
  vi.resetModules();
  return import("@/lib/geolocation");
}

/** 桩 navigator.geolocation，返回 getCurrentPosition 以便断言调用次数 */
function stubGeolocation(impl: (ok: PositionCallback, fail: PositionErrorCallback) => void) {
  const getCurrentPosition = vi.fn(impl);
  vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });
  return getCurrentPosition;
}

/** 造一个"成功定位"的回调触发 */
function succeedAt(lng: number, lat: number) {
  return (ok: PositionCallback) =>
    ok({ coords: { longitude: lng, latitude: lat } } as GeolocationPosition);
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("坐标落盘与复用", () => {
  it("定位成功后把坐标写进 localStorage（带时间戳）", async () => {
    stubGeolocation(succeedAt(120.1, 32.5));
    const geo = await loadModule();

    const coords = await geo.requestPreciseCoords();

    expect(coords).toEqual({ lng: 120.1, lat: 32.5 });
    const stored = JSON.parse(localStorage.getItem(COORDS_KEY) || "null") as {
      lng: number;
      lat: number;
      at: number;
    };
    expect(stored.lng).toBe(120.1);
    expect(stored.lat).toBe(32.5);
    expect(typeof stored.at).toBe("number");
  });

  it("刷新页面（重新加载模块）后直接复用落盘坐标，不再重新定位", async () => {
    localStorage.setItem(COORDS_KEY, JSON.stringify({ lng: 120.1, lat: 32.5, at: Date.now() }));
    const getCurrentPosition = stubGeolocation(() => {
      throw new Error("已有可用坐标时不该再请求定位");
    });
    const geo = await loadModule();

    expect(geo.hasPreciseCoords()).toBe(true);
    await expect(geo.requestPreciseCoords()).resolves.toEqual({ lng: 120.1, lat: 32.5 });
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("落盘坐标超过复用窗口后不再复用，重新定位", async () => {
    const expired = Date.now() - 31 * 60 * 1000; // TTL 为 30 分钟
    localStorage.setItem(COORDS_KEY, JSON.stringify({ lng: 1, lat: 2, at: expired }));
    const getCurrentPosition = stubGeolocation(succeedAt(120.1, 32.5));
    const geo = await loadModule();

    await expect(geo.requestPreciseCoords()).resolves.toEqual({ lng: 120.1, lat: 32.5 });
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it("坐标写入失败（隐私模式）降级为仅本次会话有效，不抛异常", async () => {
    stubGeolocation(succeedAt(120.1, 32.5));
    const geo = await loadModule();
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    await expect(geo.requestPreciseCoords()).resolves.toEqual({ lng: 120.1, lat: 32.5 });
    expect(geo.hasPreciseCoords()).toBe(true);
    setItem.mockRestore();
  });
});

describe("手动刷新（force / clearPreciseCoords）", () => {
  it("force 时忽略已有坐标与「曾被拒绝」的记忆，重新定位", async () => {
    localStorage.setItem(COORDS_KEY, JSON.stringify({ lng: 1, lat: 2, at: Date.now() }));
    localStorage.setItem(DENIED_KEY, "1");
    const getCurrentPosition = stubGeolocation(succeedAt(120.1, 32.5));
    const geo = await loadModule();

    await expect(geo.requestPreciseCoords(true)).resolves.toEqual({ lng: 120.1, lat: 32.5 });
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it("非 force 且曾记录为拒绝时不再自动请求（避免每次进站都弹框）", async () => {
    localStorage.setItem(DENIED_KEY, "1");
    const getCurrentPosition = stubGeolocation(succeedAt(120.1, 32.5));
    const geo = await loadModule();

    await expect(geo.requestPreciseCoords()).resolves.toBeNull();
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("clearPreciseCoords 同时清掉内存与落盘坐标", async () => {
    localStorage.setItem(COORDS_KEY, JSON.stringify({ lng: 1, lat: 2, at: Date.now() }));
    const geo = await loadModule();
    expect(geo.hasPreciseCoords()).toBe(true);

    geo.clearPreciseCoords();

    expect(geo.hasPreciseCoords()).toBe(false);
    expect(localStorage.getItem(COORDS_KEY)).toBeNull();
  });
});

describe("脏数据防御", () => {
  it("落盘内容不是合法 JSON 时安全忽略并清理", async () => {
    localStorage.setItem(COORDS_KEY, "{not json");
    const geo = await loadModule();

    expect(geo.hasPreciseCoords()).toBe(false);
    expect(localStorage.getItem(COORDS_KEY)).toBeNull();
  });

  it("落盘字段缺失或非数字时安全忽略并清理", async () => {
    localStorage.setItem(COORDS_KEY, JSON.stringify({ lng: "120.1", at: Date.now() }));
    const geo = await loadModule();

    expect(geo.hasPreciseCoords()).toBe(false);
    expect(localStorage.getItem(COORDS_KEY)).toBeNull();
  });

  it("浏览器不支持 geolocation 时返回 null，不抛异常", async () => {
    vi.stubGlobal("navigator", {});
    const geo = await loadModule();

    await expect(geo.requestPreciseCoords()).resolves.toBeNull();
    expect(geo.hasPreciseCoords()).toBe(false);
  });
});
